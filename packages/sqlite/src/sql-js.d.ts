declare module "sql.js" {
  export type SqlJsStatic = {
    Database: new (data?: Uint8Array) => Database
  }

  export type InitSqlJsOptions = {
    locateFile?: (file: string) => string
  }

  export type QueryExecResult = {
    columns: string[]
    values: unknown[][]
  }

  export type Statement = {
    bind(values?: unknown[]): boolean
    step(): boolean
    getAsObject(): Record<string, unknown>
    free(): void
  }

  export type Database = {
    run(sql: string, params?: unknown[]): Database
    exec(sql: string): QueryExecResult[]
    prepare(sql: string, params?: unknown[]): Statement
    export(): Uint8Array
    close(): void
  }

  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>
}
