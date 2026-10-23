"use client";

import { useParams, useRouter } from "next/navigation";

import { useDirectory, useWide } from "@/components/conversations/ConversationDirectory";
import { GroupConversationView } from "@/components/conversations/GroupConversationView";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { copy } from "@/i18n";

export default function GroupConversationPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const wide = useWide();
  const { account, characters, failure } = useDirectory();
  const back = () => router.push("/conversations");

  if (failure) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>{copy.groupConversation.loadFailed}</EmptyTitle>
          <EmptyDescription>{failure.message}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent><Button variant="outline" onClick={back}>{copy.groupConversation.back}</Button></EmptyContent>
      </Empty>
    );
  }
  if (!account || characters === null) {
    return <div className="flex h-full items-center justify-center"><Spinner className="size-6" aria-label={copy.groupConversation.loading} /></div>;
  }
  return <GroupConversationView userId={account.id} groupId={groupId} characters={characters} onBack={wide ? undefined : back} />;
}
