import { expect, test } from "@playwright/test";

import { signUpWithHousehold, uniqueEmail } from "./helpers";

test("sign up, create a household, then create and complete a chore", async ({ page }) => {
  const email = uniqueEmail("owner");
  const title = `Water the plants ${Date.now()}`;

  await signUpWithHousehold(page, email, "E2E Home");

  await page.getByRole("link", { name: "New chore" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chores/new");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("radio", { name: /^Fixed/ }).check();
  await page.getByRole("checkbox", { name: /\(you\)/ }).check();
  await page.getByRole("button", { name: "Create chore" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chores");

  await page.goto("/");
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  await page.getByRole("button", { name: `Complete "${title}"` }).click();
  await expect(page.getByRole("status")).toHaveText(`Completed "${title}".`);
  await expect(page.getByText("Nothing assigned to you right now.")).toBeVisible();
});
