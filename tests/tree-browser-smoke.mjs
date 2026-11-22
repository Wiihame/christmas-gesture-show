import assert from 'node:assert/strict';

export async function runTreeSmoke(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#christmas-viewport')?.dataset.reveal === '1.000', undefined, { timeout: 15_000 });
  const canvas = '#christmas-viewport canvas[data-scene="christmas-tree"]';
  assert.equal(await page.evaluate(() => document.querySelectorAll('#christmas-viewport canvas[data-scene="christmas-tree"]').length), 1);

  for (const [button, property] of [['#lights-toggle', 'lights'], ['#snow-toggle', 'snow'], ['#rotation-toggle', 'autoRotate']]) {
    await page.click(button);
    assert.equal(await page.evaluate((property) => document.querySelector('#christmas-viewport').dataset[property], property), 'false');
    await page.click(button);
    assert.equal(await page.evaluate((property) => document.querySelector('#christmas-viewport').dataset[property], property), 'true');
  }

  const count = await page.evaluate(() => Number(document.querySelector('#christmas-viewport').dataset.replayCount));
  await page.click('#replay-tree');
  await page.waitForFunction((count) => Number(document.querySelector('#christmas-viewport').dataset.replayCount) > count, count);
  await page.waitForFunction(() => document.querySelector('#christmas-viewport').dataset.reveal === '1.000', undefined, { timeout: 15_000 });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#christmas-viewport canvas[data-scene="christmas-tree"]').length), 1);

  const bounds = await page.evaluate(() => {
    const box = document.querySelector('#christmas-viewport canvas[data-scene="christmas-tree"]').getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + bounds.height / 2 - 15);
  await page.mouse.up();

  const extensionAvailable = await page.evaluate(() => {
    const canvas = document.querySelector('#christmas-viewport canvas[data-scene="christmas-tree"]');
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__treeSmokeExtension = extension;
    extension.loseContext();
    return true;
  });
  if (extensionAvailable) {
    await page.waitForFunction(() => document.querySelector('#christmas-viewport').dataset.sceneStatus === 'context-lost');
    await page.evaluate(() => window.__treeSmokeExtension.restoreContext());
    await page.waitForFunction(() => document.querySelector('#christmas-viewport').dataset.sceneStatus === 'ready', undefined, { timeout: 10_000 });
  }
  await page.waitForSelector(canvas);

  return {
    url,
    recordedAt: new Date().toISOString(),
    checks: ['single-renderer-canvas', 'lights-toggle', 'snow-toggle', 'rotation-toggle', 'replay-without-extra-canvas', 'pointer-orbit-input'],
    contextRestoreTested: extensionAvailable,
    state: await page.evaluate(() => ({ ...document.querySelector('#christmas-viewport').dataset })),
  };
}
