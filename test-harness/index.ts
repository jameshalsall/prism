import { ChildProcess, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import { validate } from 'gavel';
import * as globFs from 'glob-fs';
import { parseResponse } from 'http-string-parser';
import * as os from 'os';
import * as path from 'path';
import * as split2 from 'split2';
import * as tmp from 'tmp';
import { parseSpecFile } from './helpers';

const glob = globFs({ gitignore: true });
jest.setTimeout(5000);

describe('harness', () => {
  const files = process.env.TESTS
    ? String(process.env.TESTS).split(',')
    : glob.readdirSync('**/*.txt', { cwd: path.join(__dirname, './specs') });

  files.forEach(file => {
    const data = fs.readFileSync(path.join(__dirname, './specs/', file), { encoding: 'utf8' });
    const parsed = parseSpecFile(data);

    let prismMockProcessHandle: ChildProcess;
    let tmpFileHandle: tmp.FileSyncObject;

    beforeAll(() => {
      tmpFileHandle = tmp.fileSync({
        postfix: '.yml',
        dir: undefined,
        name: undefined,
        prefix: undefined,
        tries: 10,
        template: undefined,
        unsafeCleanup: undefined,
      });

      fs.writeFileSync(tmpFileHandle.name, parsed.spec, { encoding: 'utf8' });
    });

    afterAll(() => tmpFileHandle.removeCallback(undefined, undefined, undefined, undefined));

    test(`${file}${os.EOL}${parsed.test}`, done => {
      const [command, ...args] = parsed.command.split(' ').map(t => t.trim());
      const serverArgs = [...parsed.server.split(' ').map(t => t.trim()), tmpFileHandle.name];

      prismMockProcessHandle = spawn(path.join(__dirname, '../cli-binaries/prism-cli'), serverArgs);

      prismMockProcessHandle.stdout.pipe(split2()).on('data', (line: string) => {
        if (line.includes('Prism is listening')) {
          const clientCommandHandle = spawnSync(command, args, {
            shell: true,
            encoding: 'utf8',
            windowsVerbatimArguments: false,
          });
          const output: any = parseResponse(clientCommandHandle.stdout.trim());
          const expected: any = parseResponse(parsed.expect.trim() || parsed.expectLoose.trim());

          try {
            const isValid = validate(expected, output).valid;
            if (!!isValid) expect(validate(expected, output).valid).toBeTruthy();
            else {
              expect(output).toMatchObject(expected);
            }
            if (parsed.expect) expect(output.body).toMatch(expected.body);
          } catch (e) {
            prismMockProcessHandle.kill();
            return prismMockProcessHandle.on('exit', () => done(e));
          }
          prismMockProcessHandle.kill();
          prismMockProcessHandle.on('exit', done);
        }
      });
    });
  });
});
