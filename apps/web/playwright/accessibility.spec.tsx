import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/experimental-ct-react";
import {
  DialogFixture,
  MenuFixture,
  TableFixture,
} from "./accessibility-fixtures";

async function expectNoAxeViolations(
  page: ConstructorParameters<typeof AxeBuilder>[0]["page"],
  selector: string,
) {
  const results = await new AxeBuilder({ page }).include(selector).analyze();
  expect(results.violations).toEqual([]);
}

test("dialog has an accessible name, traps focus, and passes axe", async ({
  mount,
  page,
}) => {
  await mount(<DialogFixture />);
  const trigger = page.getByRole("button", { name: "Delete transaction" });

  await trigger.click();

  const dialog = page.getByRole("dialog", {
    name: "Remove PETR4 transaction?",
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(
      "This permanently removes 10 shares traded on 2025-01-15.",
    ),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expectNoAxeViolations(page, '[data-slot="dialog-content"]');

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("table exposes its caption and headers and passes axe", async ({
  mount,
  page,
}) => {
  await mount(<TableFixture />);

  const table = page.getByRole("table", {
    name: "Current portfolio positions",
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(2);
  await expect(table.getByRole("row")).toHaveCount(2);
  await expectNoAxeViolations(page, '[data-slot="table-container"]');
});

test("dropdown menu supports keyboard focus and passes axe", async ({
  mount,
  page,
}) => {
  await mount(<MenuFixture />);
  const trigger = page.getByRole("button", {
    name: "Transaction actions",
  });

  await trigger.focus();
  await page.keyboard.press("Enter");

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Edit transaction" }),
  ).toBeFocused();
  await expectNoAxeViolations(page, '[data-slot="dropdown-menu-content"]');

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});
