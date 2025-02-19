import { IDiagnostic } from '@stoplight/types';
import { Either } from 'fp-ts/lib/Either';
import { Reader } from 'fp-ts/lib/Reader';
import { TaskEither } from 'fp-ts/lib/TaskEither';
import { Logger } from 'pino';
export type IPrismDiagnostic = Omit<IDiagnostic, 'range'>;

// END

export interface IPrism<Resource, Input, Output, Config> {
  process: (input: Input, resources: Resource[], config?: Config) => Promise<IPrismOutput<Input, Output>>;
}

export type PartialPrismConfigFactory<C, I> = (
  input: I,
  defaultConfig?: PartialPrismConfig<C, I> | PrismConfig<C, I>,
) => Partial<C>;
export type PartialPrismConfig<C, I> = Partial<C> | PrismConfigFactory<C, I> | PartialPrismConfigFactory<C, I>;

export interface IPrismConfig {
  mock?: boolean | object;
  security?: boolean | object;
  validateRequest: boolean;
  validateResponse: boolean;
}

export type PrismConfigFactory<C, I> = (input: I, defaultConfig?: PrismConfig<C, I>) => C;
export type PrismConfig<C, I> = C | PrismConfigFactory<C, I>;

export interface IRouter<Resource, Input, Config> {
  route: (
    opts: { resources: Resource[]; input: Input; config?: Config },
    defaultRouter?: IRouter<Resource, Input, Config>,
  ) => Either<Error, Resource>;
}

export interface IForwarder<Resource, Input, Config, Output> {
  forward: (
    opts: { resource?: Resource; input: IPrismInput<Input>; config?: Config },
    defaultForwarder?: IForwarder<Resource, Input, Config, Output>,
  ) => Promise<Output>;
  fforward: (
    opts: { resource?: Resource; input: IPrismInput<Input>; config?: Config },
    defaultForwarder?: IForwarder<Resource, Input, Config, Output>,
  ) => TaskEither<Error, Output>;
}

export interface IMocker<Resource, Input, Config, Output> {
  mock: (
    opts: IMockerOpts<Resource, Input, Config>,
    defaultMocker?: IMocker<Resource, Input, Config, Output>,
  ) => Output;
}

export interface IMockerOpts<Resource, Input, Config> {
  resource: Resource;
  input: IPrismInput<Input>;
  config?: Config;
}

export interface IValidator<Resource, Input, Config, Output> {
  validateInput?: (
    opts: { resource: Resource; input: Input; config?: Config },
    defaultValidator?: IValidator<Resource, Input, Config, Output>,
  ) => IPrismDiagnostic[];
  validateOutput?: (
    opts: { resource: Resource; output?: Output; config?: Config },
    defaultValidator?: IValidator<Resource, Input, Config, Output>,
  ) => IPrismDiagnostic[];
}

export interface IPrismComponents<Resource, Input, Output, Config> {
  router: IRouter<Resource, Input, Config>;
  forwarder: IForwarder<Resource, Input, Config, Output>;
  mocker: IMocker<Resource, Input, Config, Reader<Logger, Either<Error, Output>>>;
  validator: IValidator<Resource, Input, Config, Output>;
  logger: Logger;
}

export interface IPrismInput<I> {
  data: I;
  validations: {
    input: IPrismDiagnostic[];
  };
}

export interface IPrismOutput<I, O> {
  input?: I;
  output?: O;
  validations: {
    input: IPrismDiagnostic[];
    output: IPrismDiagnostic[];
  };
}

export type ProblemJson = {
  type: string;
  title: string;
  status: number;
  detail: string;
};

export type PickRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

export class ProblemJsonError extends Error {
  public static fromTemplate(template: Omit<ProblemJson, 'detail'>, detail?: string): ProblemJsonError {
    const error = new ProblemJsonError(
      `https://stoplight.io/prism/errors#${template.type}`,
      template.title,
      template.status,
      detail || '',
    );
    Error.captureStackTrace(error, ProblemJsonError);

    return error;
  }

  public static fromPlainError(error: Error & { detail?: string; status?: number }): ProblemJson {
    return {
      type: error.name && error.name !== 'Error' ? error.name : 'https://stoplight.io/prism/errors#UNKNOWN',
      title: error.message,
      status: error.status || 500,
      detail: error.detail || '',
    };
  }

  constructor(readonly name: string, readonly message: string, readonly status: number, readonly detail: string) {
    super(message);
    Error.captureStackTrace(this, ProblemJsonError);
  }
}
