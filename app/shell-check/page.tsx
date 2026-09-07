// Throwaway route to prove every page renders inside the root shell
// (header + centered container) with no extra layout code. Remove once
// real routes exist.
export default function ShellCheck() {
  return (
    <section className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Shell check</h1>
      <p className="text-muted-foreground">
        This page defines no layout of its own, yet it still shows the shared
        header and sits in the same centered container as every other route.
      </p>
    </section>
  );
}
