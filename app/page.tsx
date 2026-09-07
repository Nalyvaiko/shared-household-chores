import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Chores</h1>
      <p className="text-muted-foreground">
        Your household&rsquo;s chores will show up here.
      </p>
      <Button disabled>New chore</Button>
    </section>
  );
}
