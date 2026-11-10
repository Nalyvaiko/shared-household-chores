"use client";

import { useEffect } from "react";

/**
 * Resets the form with id `formId` when the browser restores the page from the
 * back-forward cache. The restored DOM keeps whatever the controls held when
 * the page was left (such as filters edited and then applied), while the
 * server-rendered defaults are what the page's URL means. Other loads and
 * navigations are left alone. Renders nothing.
 */
export function ResetFormOnRestore({ formId }: { formId: string }) {
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      const form = document.getElementById(formId);
      if (form instanceof HTMLFormElement) form.reset();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [formId]);

  return null;
}
