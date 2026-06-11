declare module "pg" {
  export class Pool {
    constructor(options?: Record<string, unknown>)
    query<T extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[]
    ): Promise<{ rows: T[] }>
    end(): Promise<void>
  }
}
