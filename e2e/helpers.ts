import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";

/** An email no other run or test uses. */
export function uniqueEmail(label: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `e2e-${label}-${suffix}@example.com`;
}

/** Fills and submits the sign-up form on the current page. */
export async function submitSignup(page: Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

/** Signs up a new user and creates their household; ends on the dashboard. */
export async function signUpWithHousehold(page: Page, email: string, householdName: string) {
  await page.goto("/signup");
  await submitSignup(page, email);
  await expect(page).toHaveURL((url) => url.pathname === "/household/new");

  await page.getByLabel("Household name").fill(householdName);
  await page.getByRole("button", { name: "Create household" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("heading", { name: "My chores" })).toBeVisible();
}
