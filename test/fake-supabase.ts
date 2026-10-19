/**
 * Поддельный Supabase-клиент в памяти — для тестов, которым мало подменить
 * один ответ: сценарий из нескольких шагов пишет и читает одни и те же строки.
 *
 * Понимает ровно то, чем пользуются сторы бота: select / insert / upsert
 * (ignoreDuplicates) / update, фильтры eq, is, not (is null, in), lte, lt, or
 * (is.null / lt.N), order, limit и окончания maybeSingle / single / await.
 * Чего не понимает — бросает, чтобы тест не прошёл молча на неверном запросе.
 */

export type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Значения по умолчанию для insert — как DEFAULT в миграции. */
  defaults: Record<string, (row: Row, db: FakeDb) => Row>;
  /** Сколько раз база «упадёт» на следующих запросах. */
  failNext: number;
}

export function createFakeDb(defaults: FakeDb["defaults"] = {}): FakeDb {
  return { tables: {}, defaults, failNext: 0 };
}

type Filter = (row: Row) => boolean;

function parseList(v: string): string[] {
  return v.replace(/^\(|\)$/g, "").split(",");
}

function orCondition(expr: string): Filter {
  const [col, op, val] = expr.split(".");
  if (op === "is" && val === "null") return (r) => r[col] === null || r[col] === undefined;
  if (op === "lt") return (r) => r[col] !== null && Number(r[col]) < Number(val);
  throw new Error(`fake-supabase: or ${expr}`);
}

class Query implements PromiseLike<{ data: unknown; error: { message: string } | null }> {
  private op: "select" | "update" | "upsert" | "insert" = "select";
  private payload: Row = {};
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Filter[] = [];
  private orderBy: { col: string; asc: boolean } | null = null;
  private max: number | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(): this {
    return this;
  }
  update(patch: Row): this {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  upsert(row: Row, opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = "upsert";
    this.payload = row;
    this.upsertOpts = opts;
    return this;
  }
  insert(row: Row): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: null): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  not(col: string, op: string, val: unknown): this {
    if (op === "is" && val === null) this.filters.push((r) => r[col] !== null && r[col] !== undefined);
    else if (op === "in") {
      const list = parseList(String(val));
      this.filters.push((r) => !list.includes(String(r[col])));
    } else throw new Error(`fake-supabase: not ${op}`);
    return this;
  }
  lte(col: string, val: string | number): this {
    this.filters.push((r) => (r[col] as string | number) <= val);
    return this;
  }
  lt(col: string, val: string | number): this {
    this.filters.push((r) => (r[col] as string | number) < val);
    return this;
  }
  or(expr: string): this {
    const conds = expr.split(",").map(orCondition);
    this.filters.push((r) => conds.some((c) => c(r)));
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orderBy = { col, asc: opts.ascending !== false };
    return this;
  }
  limit(n: number): this {
    this.max = n;
    return this;
  }

  private rows(): Row[] {
    if (!this.db.tables[this.table]) this.db.tables[this.table] = [];
    return this.db.tables[this.table];
  }

  private withDefaults(row: Row): Row {
    const fill = this.db.defaults[this.table];
    return fill ? fill(row, this.db) : { ...row };
  }

  private run(): Row[] {
    const rows = this.rows();
    const match = (r: Row) => this.filters.every((f) => f(r));

    if (this.op === "insert") {
      const row = this.withDefaults(this.payload);
      rows.push(row);
      return [row];
    }

    if (this.op === "upsert") {
      const keys = (this.upsertOpts.onConflict ?? "").split(",").filter(Boolean);
      const existing = rows.find((r) => keys.every((k) => r[k] === this.payload[k]));
      if (existing) {
        if (this.upsertOpts.ignoreDuplicates) return [];
        Object.assign(existing, this.payload);
        return [existing];
      }
      const row = this.withDefaults(this.payload);
      rows.push(row);
      return [row];
    }

    if (this.op === "update") {
      const hit = rows.filter(match);
      for (const r of hit) Object.assign(r, this.payload);
      return hit.map((r) => ({ ...r }));
    }

    let out = rows.filter(match).map((r) => ({ ...r }));
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = out.sort((a, b) => {
        const x = a[col] as string | number;
        const y = b[col] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    if (this.max !== null) out = out.slice(0, this.max);
    return out;
  }

  private exec<T>(shape: (rows: Row[]) => T): Promise<{ data: T | null; error: { message: string } | null }> {
    if (this.db.failNext > 0) {
      this.db.failNext--;
      return Promise.resolve({ data: null, error: { message: "fake failure" } });
    }
    return Promise.resolve({ data: shape(this.run()), error: null });
  }

  maybeSingle() {
    return this.exec((rows) => rows[0] ?? null);
  }
  single() {
    return this.exec((rows) => {
      if (rows.length !== 1) throw new Error("fake-supabase: single() без единственной строки");
      return rows[0];
    });
  }
  then<A, B>(
    onfulfilled?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.exec((rows) => rows).then(onfulfilled, onrejected);
  }
}

export function fakeClient(db: FakeDb) {
  return { from: (table: string) => new Query(db, table) };
}
