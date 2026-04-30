import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    cgdbDbPath: string;
  }
}
