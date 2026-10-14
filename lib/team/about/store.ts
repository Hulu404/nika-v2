import { tgAdmin } from "../../telegram/supabase";

/**
 * «📌 О проекте» (миграция 061): разделы проекта (суть, материалы, цифры,
 * правила) и открытые вопросы. Сид пишет только пустые разделы и вопросы,
 * которых ещё нет.
 */

export type InfoSection = "summary" | "links" | "facts" | "rules" | "questions";

export interface ProjectQuestion {
  id: number;
  project_id: string;
  question: string;
  owner_chat_id: number | null;
  /** «Юрист», «Продукт и клиника» — кто решает, если это не человек из команды. */
  owner_label: string | null;
  due_date: string | null;
  /** «до первой реальной SMS», «первая неделя» — срок словами. */
  due_label: string | null;
  status: "open" | "answered";
  answer: string | null;
  answered_by: number | null;
  answered_at: string | null;
}

export type NewQuestion = Pick<ProjectQuestion, "question" | "owner_chat_id" | "owner_label" | "due_date" | "due_label">;

export interface AboutStore {
  getSection(projectId: string, section: InfoSection): Promise<string | null>;
  setSection(projectId: string, section: InfoSection, content: string, by: number, now: Date): Promise<void>;
  questions(projectId: string): Promise<ProjectQuestion[]>;
  question(id: number): Promise<ProjectQuestion | null>;
  answer(id: number, answer: string, by: number, now: Date): Promise<ProjectQuestion | null>;
  /** Сид: пустые разделы и новые вопросы. Возвращает, сколько записано. */
  seed(projectId: string, sections: Partial<Record<InfoSection, string>>, questions: readonly NewQuestion[], now: Date): Promise<number>;
}

export function supabaseAboutStore(): AboutStore {
  const info = () => tgAdmin().from("project_info");
  const qs = () => tgAdmin().from("project_questions");
  const fail = (table: string, e: { message: string }) => new Error(`${table}: ${e.message}`);
  return {
    async getSection(projectId, section) {
      const { data, error } = await info().select("content").eq("project_id", projectId).eq("section", section).maybeSingle();
      if (error) throw fail("project_info", error);
      return ((data as { content: string } | null)?.content ?? null) || null;
    },
    async setSection(projectId, section, content, by, now) {
      const { error } = await info().upsert({ project_id: projectId, section, content, updated_by: by, updated_at: now.toISOString() }, { onConflict: "project_id,section" });
      if (error) throw fail("project_info", error);
    },
    async questions(projectId) {
      const { data, error } = await qs().select("*").eq("project_id", projectId).order("id");
      if (error) throw fail("project_questions", error);
      return (data ?? []) as ProjectQuestion[];
    },
    async question(id) {
      const { data, error } = await qs().select("*").eq("id", id).maybeSingle();
      if (error) throw fail("project_questions", error);
      return (data as ProjectQuestion | null) ?? null;
    },
    async answer(id, answer, by, now) {
      const { data, error } = await qs().update({ status: "answered", answer, answered_by: by, answered_at: now.toISOString() }).eq("id", id).select("*").maybeSingle();
      if (error) throw fail("project_questions", error);
      return (data as ProjectQuestion | null) ?? null;
    },
    async seed(projectId, sections, questions, now) {
      let n = 0;
      for (const [section, content] of Object.entries(sections)) {
        const { data, error } = await info().upsert({ project_id: projectId, section, content, updated_at: now.toISOString() },
          { onConflict: "project_id,section", ignoreDuplicates: true }).select("section");
        if (error) throw fail("project_info", error);
        n += (data ?? []).length;
      }
      if (questions.length) {
        const { data, error } = await qs().upsert(questions.map((q) => ({ ...q, project_id: projectId, created_at: now.toISOString() })),
          { onConflict: "project_id,question", ignoreDuplicates: true }).select("id");
        if (error) throw fail("project_questions", error);
        n += (data ?? []).length;
      }
      return n;
    },
  };
}

export class MemoryAboutStore implements AboutStore {
  sections = new Map<string, string>();
  qs: ProjectQuestion[] = [];
  async getSection(projectId: string, section: InfoSection) {
    return this.sections.get(`${projectId}:${section}`) || null;
  }
  async setSection(projectId: string, section: InfoSection, content: string) {
    this.sections.set(`${projectId}:${section}`, content);
  }
  async questions(projectId: string) {
    return this.qs.filter((q) => q.project_id === projectId).map((q) => ({ ...q }));
  }
  async question(id: number) {
    const q = this.qs.find((x) => x.id === id);
    return q ? { ...q } : null;
  }
  async answer(id: number, answer: string, by: number, now: Date) {
    const q = this.qs.find((x) => x.id === id);
    if (!q) return null;
    Object.assign(q, { status: "answered", answer, answered_by: by, answered_at: now.toISOString() });
    return { ...q };
  }
  async seed(projectId: string, sections: Partial<Record<InfoSection, string>>, questions: readonly NewQuestion[], _now?: Date) {
    let n = 0;
    for (const [section, content] of Object.entries(sections)) {
      const key = `${projectId}:${section}`;
      if (this.sections.has(key)) continue;
      this.sections.set(key, content!);
      n++;
    }
    for (const q of questions) {
      if (this.qs.some((x) => x.project_id === projectId && x.question === q.question)) continue;
      this.qs.push({ id: this.qs.length + 1, project_id: projectId, status: "open", answer: null, answered_by: null, answered_at: null, ...q });
      n++;
    }
    return n;
  }
}
