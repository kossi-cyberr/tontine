import { expect, test } from '@playwright/test';
import {
  API_URL,
  PASSWORD,
  confirmMockPayment,
  createLaunchedGroup,
  registerUser,
  seedSession,
  uniquePhone,
} from './helpers';

test.describe('Parcours financiers de la tontine', () => {
  test('inscription immédiate puis accès au profil', async ({ page }) => {
    const phone = uniquePhone();

    await page.goto('/inscription');
    await page.getByLabel('Nom complet').fill('Alice Test E2E');
    await page.getByLabel('Téléphone').fill(phone);
    await page.getByLabel('Mot de passe').fill(PASSWORD);
    await page.getByRole('button', { name: 'Créer mon compte' }).click();

    await expect(page).toHaveURL(/\/profil/);
    const accessToken = await page.evaluate(() => localStorage.getItem('tontine.access_token'));
    expect(accessToken).toBeTruthy();
  });

  test('création d’un groupe depuis l’interface', async ({ page, request }) => {
    const president = await registerUser(request, 'Président Création E2E');
    await seedSession(page, president);

    const groupName = `Tontine E2E ${Date.now()}`;

    await page.goto('/groupes/nouveau');
    await page.getByLabel('Nom du groupe').fill(groupName);
    await page.getByRole('button', { name: 'Créer le groupe' }).click();

    await expect(page).toHaveURL(/\/groupes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: groupName })).toBeVisible();

    const groupId = page.url().split('/').pop();
    expect(groupId).toBeTruthy();

    const response = await request.get(`${API_URL}/v1/groups/${groupId}`, {
      headers: { Authorization: `Bearer ${president.access_token}` },
    });
    expect(response.ok()).toBeTruthy();
    const group = (await response.json()) as { name: string; my_role: string };
    expect(group.name).toBe(groupName);
    expect(group.my_role).toBe('president');
  });

  test('paiement d’une cotisation puis confirmation par webhook', async ({ page, request }) => {
    const fixture = await createLaunchedGroup(request);
    await seedSession(page, fixture.member);

    await page.goto(`/groupes/${fixture.groupId}`);
    await page.getByRole('button', { name: 'Payer', exact: true }).click();

    await page.getByRole('button', { name: 'Payer ma cotisation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Payer ma cotisation' });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel('Numéro à débiter').fill('+237677000099');
    await dialog.getByRole('button', { name: /Payer .*XAF/ }).click();

    await expect(dialog.getByText('Confirmation en cours')).toBeVisible();

    const reference = (await dialog.locator('p.font-mono').textContent())?.trim();
    expect(reference).toBeTruthy();

    await confirmMockPayment(request, reference!, 5000);

    await dialog.getByRole('button', { name: 'J’ai confirmé, vérifier maintenant' }).click();
    await expect(dialog.getByText('Paiement confirmé')).toBeVisible({ timeout: 20_000 });

    await dialog.getByRole('button', { name: 'Fermer' }).last().click();
    await expect(page.getByText('Ma cotisation de ce tour est réglée.')).toBeVisible();
  });
});
