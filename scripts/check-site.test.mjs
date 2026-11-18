import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisarHead } from './check-site.mjs';

test('lê title, description, og:image e favicon só do <head>', () => {
  const html = `<html><head><title> Spa </title>
    <meta content='Massagens' name="description"><meta property=og:image content="https://x/og.png">
    <link rel="shortcut icon" href="/f.ico"></head><body><meta name="description" content="corpo"></body></html>`;
  assert.deepEqual(analisarHead(html), { titulo: 'Spa', descricao: 'Massagens', ogImage: 'https://x/og.png', favicon: true });
});

test('marca o que falta', () => {
  assert.deepEqual(analisarHead('<head><link rel="stylesheet" href="a.css"></head>'), { titulo: '', descricao: '', ogImage: '', favicon: false });
});
