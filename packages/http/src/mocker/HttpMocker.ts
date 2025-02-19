import { IMocker, IMockerOpts, IPrismInput } from '@stoplight/prism-core';
import { DiagnosticSeverity, Dictionary, IHttpHeaderParam, IHttpOperation, INodeExample } from '@stoplight/types';

import * as caseless from 'caseless';
import { Either, map } from 'fp-ts/lib/Either';
import { pipe } from 'fp-ts/lib/pipeable';
import { chain, Reader } from 'fp-ts/lib/Reader';
import { mapLeft } from 'fp-ts/lib/ReaderEither';
import { isEmpty, isObject, keyBy, mapValues } from 'lodash';
import { Logger } from 'pino';
import {
  ContentExample,
  IHttpConfig,
  IHttpOperationConfig,
  IHttpRequest,
  IHttpResponse,
  PayloadGenerator,
  ProblemJsonError,
} from '../types';
import withLogger from '../withLogger';
import { FORBIDDEN, UNAUTHORIZED, UNPROCESSABLE_ENTITY } from './errors';
import { generate, generateStatic } from './generator/JSONSchema';
import helpers from './negotiator/NegotiatorHelpers';
import { IHttpNegotiationResult } from './negotiator/types';

export class HttpMocker
  implements IMocker<IHttpOperation, IHttpRequest, IHttpConfig, Reader<Logger, Either<Error, IHttpResponse>>> {
  public mock({
    resource,
    input,
    config,
  }: IMockerOpts<IHttpOperation, IHttpRequest, IHttpConfig>): Reader<Logger, Either<Error, IHttpResponse>> {
    const payloadGenerator: PayloadGenerator =
      config && typeof config.mock !== 'boolean' && config.mock.dynamic ? generate : generateStatic;

    return pipe(
      withLogger(logger => {
        // setting default values
        const acceptMediaType = input.data.headers && caseless(input.data.headers).get('accept');
        config = config || { mock: false, cors: false, validateRequest: true, validateResponse: true };
        const mockConfig: IHttpOperationConfig =
          config.mock === false ? { dynamic: false } : Object.assign({}, config.mock);

        if (!mockConfig.mediaTypes && acceptMediaType) {
          logger.info(`Request contains an accept header: ${acceptMediaType}`);
          mockConfig.mediaTypes = acceptMediaType.split(',');
        }

        return mockConfig;
      }),
      chain(mockConfig => negotiateResponse(mockConfig, input, resource)),
      chain(result => assembleResponse(result, payloadGenerator)),
    );
  }
}

function handleInputValidation(input: IPrismInput<IHttpRequest>, resource: IHttpOperation) {
  return pipe(
    withLogger(logger => logger.warn({ name: 'VALIDATOR' }, 'Request did not pass the validation rules')),
    chain(() =>
      pipe(
        helpers.negotiateOptionsForInvalidRequest(resource.responses),
        mapLeft(() => {
          const securityValidation = input.validations.input.find(i => i.code === 401 || i.code === 403);

          return securityValidation
            ? ProblemJsonError.fromTemplate(
                securityValidation.code === 401 ? UNAUTHORIZED : FORBIDDEN,
                '',
                securityValidation.tags && securityValidation.tags.length
                  ? {
                      headers: { 'WWW-Authenticate': securityValidation.tags.join(',') },
                    }
                  : undefined,
              )
            : ProblemJsonError.fromTemplate(
                UNPROCESSABLE_ENTITY,
                'Your request body is not valid and no HTTP validation response was found in the spec, so Prism is generating this error for you.',
                {
                  validation: input.validations.input.map(detail => ({
                    location: detail.path,
                    severity: DiagnosticSeverity[detail.severity],
                    code: detail.code,
                    message: detail.message,
                  })),
                },
              );
        }),
      ),
    ),
  );
}

function negotiateResponse(
  mockConfig: IHttpOperationConfig,
  input: IPrismInput<IHttpRequest>,
  resource: IHttpOperation,
) {
  if (input.validations.input.length > 0) {
    return handleInputValidation(input, resource);
  } else {
    return pipe(
      withLogger(logger =>
        logger.success({ name: 'VALIDATOR' }, 'The request passed the validation rules. Looking for the best response'),
      ),
      chain(() => helpers.negotiateOptionsForValidRequest(resource, mockConfig)),
    );
  }
}

function assembleResponse(
  result: Either<Error, IHttpNegotiationResult>,
  payloadGenerator: PayloadGenerator,
): Reader<Logger, Either<Error, IHttpResponse>> {
  return withLogger(logger =>
    pipe(
      result,
      map(negotiationResult => {
        const mockedBody = computeBody(negotiationResult, payloadGenerator);
        const mockedHeaders = computeMockedHeaders(negotiationResult.headers || [], payloadGenerator);

        const response: IHttpResponse = {
          statusCode: parseInt(negotiationResult.code),
          headers: {
            ...mockedHeaders,
            'Content-type': negotiationResult.mediaType,
          },
          body: mockedBody,
        };

        logger.success(`Responding with the requested status code ${response.statusCode}`);

        return response;
      }),
    ),
  );
}

function isINodeExample(nodeExample: ContentExample | undefined): nodeExample is INodeExample {
  return !!nodeExample && 'value' in nodeExample;
}

function computeMockedHeaders(headers: IHttpHeaderParam[], payloadGenerator: PayloadGenerator): Dictionary<string> {
  return mapValues(keyBy(headers, h => h.name), header => {
    if (header.schema) {
      if (header.examples && header.examples.length > 0) {
        const example = header.examples[0];
        if (isINodeExample(example)) {
          return example.value;
        }
      } else {
        const example = payloadGenerator(header.schema);
        if (!(isObject(example) && isEmpty(example))) return example;
      }
    }
    return null;
  });
}

function computeBody(
  negotiationResult: Pick<IHttpNegotiationResult, 'schema' | 'mediaType' | 'bodyExample'>,
  payloadGenerator: PayloadGenerator,
) {
  if (isINodeExample(negotiationResult.bodyExample) && negotiationResult.bodyExample.value !== undefined) {
    return negotiationResult.bodyExample.value;
  } else if (negotiationResult.schema) {
    return payloadGenerator(negotiationResult.schema);
  }
  return undefined;
}
