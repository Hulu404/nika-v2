import { notFound, redirect } from "next/navigation";
import { Chat } from "@/components/Chat";
import { getLastConversation } from "@/lib/conversations";
import { SCENARIO_META, SCENARIO_ORDER } from "@/lib/scenarios";
import { createServerComponentClient } from "@/lib/supabase";
import type { ChatMessage, Scenario } from "@/types/conversation";

function isScenario(value: string): value is Scenario {
  return (SCENARIO_ORDER as string[]).includes(value);
}

export default async function ChatPage({
  params,
}: {
  params: { scenario: string };
}) {
  if (!isScenario(params.scenario)) {
    notFound();
  }
  const scenario = params.scenario;

  const supabase = await createServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/auth?next=/chat/${scenario}`);
  }

  const conversation = await getLastConversation(supabase, user.id, scenario);

  // Опенер НИКИ всегда из SCENARIO_META; в БД он не хранится.
  const opener: ChatMessage = {
    id: "opener",
    role: "assistant",
    content: SCENARIO_META[scenario].opener,
    createdAt: new Date().toISOString(),
  };

  const initialMessages: ChatMessage[] = conversation
    ? [
        opener,
        ...conversation.messages.map((m, i) => ({
          id: `${conversation.id}-${i}`,
          role: m.role,
          content: m.content,
          createdAt: m.timestamp,
        })),
      ]
    : [opener];

  return (
    <Chat
      scenario={scenario}
      initialMessages={initialMessages}
      conversationId={conversation?.id ?? null}
    />
  );
}
