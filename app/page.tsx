import NotesPage from "./notes-page";
import { requireChatGPTUser, chatGPTSignOutPath } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <NotesPage accountName={user.displayName} accountEmail={user.email} signOutPath={chatGPTSignOutPath("/")} />;
}
