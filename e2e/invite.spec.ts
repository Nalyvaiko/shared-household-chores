import { expect, test } from "@playwright/test";

import { signUpWithHousehold, submitSignup, uniqueEmail } from "./helpers";

test("a new user signs up through an invite link and joins as a member", async ({
  page,
  browser,
}) => {
  const adminEmail = uniqueEmail("admin");
  const memberEmail = uniqueEmail("member");
  const householdName = `E2E Flat ${Date.now()}`;

  await signUpWithHousehold(page, adminEmail, householdName);

  await page.goto("/household/members");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const inviteField = page.getByLabel("Invite URL");
  await expect(inviteField).toHaveValue(/\/invite\/\S+$/);
  const inviteUrl = await inviteField.inputValue();
  const invitePath = new URL(inviteUrl).pathname;

  // The invitee gets a separate browser context, so no cookies are shared.
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();

  // Signed out, the invite sends them to sign in with the invite as callbackUrl.
  await invitee.goto(inviteUrl);
  await expect(invitee).toHaveURL(
    (url) => url.pathname === "/signin" && url.searchParams.get("callbackUrl") === invitePath,
  );
  await invitee.getByRole("main").getByRole("link", { name: "Sign up" }).click();
  await expect(invitee).toHaveURL(
    (url) => url.pathname === "/signup" && url.searchParams.get("callbackUrl") === invitePath,
  );

  await submitSignup(invitee, memberEmail);
  await expect(invitee).toHaveURL((url) => url.pathname === invitePath);
  await expect(invitee.getByRole("heading", { name: `Join ${householdName}` })).toBeVisible();
  await invitee.getByRole("button", { name: "Join household" }).click();
  await expect(invitee).toHaveURL((url) => url.pathname === "/");
  await expect(invitee.getByRole("heading", { name: "My chores" })).toBeVisible();
  await inviteeContext.close();

  // The admin sees the new user listed as a member.
  await page.reload();
  const memberRow = page.getByRole("listitem").filter({ hasText: memberEmail });
  await expect(memberRow.getByText("Member", { exact: true })).toBeVisible();
});
