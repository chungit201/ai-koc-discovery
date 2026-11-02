import { redirect } from "next/navigation";

// The overview page was removed; the creator list is the home of the app.
export default function Home() {
  redirect("/kocs");
}
