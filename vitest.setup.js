import { readFileSync } from 'fs';
import { JSDOM } from 'jsdom';

const html = readFileSync('./index.html', 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
