const { expect, test } = require("@playwright/test");

test("public landing and connection paths", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Your board changed. Your pick should too.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Enter a draft room" })).toBeVisible();
  await expect(page.getByText(/2026 season/i)).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Continue with Yahoo" })).toBeVisible();
  await expect(page.getByLabel("Sleeper username")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open draft lobby" })).toBeVisible();

  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: "Join a live room or build your own." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create public draft" })).toBeDisabled();
});

test("landing remains within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Enter a draft room" })).toBeVisible();
  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(sizes.scroll).toBe(sizes.client);
});

test("authenticated draft board boots", async ({ page }) => {
  const secret =
    process.env.E2E_LOGIN_SECRET?.trim() ||
    process.env.APP_ACCESS_PASSWORD?.trim();
  test.skip(!secret, "Set E2E_LOGIN_SECRET to exercise authenticated browser coverage");

  const login = await page.request.post("/api/auth/dev-login", {
    data: { secret },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Draft Dojo" })).toBeVisible();
});
