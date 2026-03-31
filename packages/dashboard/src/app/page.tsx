import { getCharacters } from "@/lib/data";
import { ChatHomepage } from "@/components/chat-homepage";

export default function Home() {
  const characters = getCharacters();

  return <ChatHomepage characters={characters} />;
}
