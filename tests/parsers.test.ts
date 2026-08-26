import { describe, it, expect } from 'vitest';
import { parseFile, parseFiles, MAX_EXCERPT } from '../src/lib/parsers';
import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function createFile(name: string, content: string | Buffer, mimeType?: string): File {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return new File([buffer], name, { type: mimeType || 'application/octet-stream' });
}

describe('parseFile', () => {
  it('should parse TXT files', async () => {
    const file = createFile('test.txt', 'Hello world\nThis is a test file.');
    const result = await parseFile(file);
    
    expect(result.fileName).toBe('test.txt');
    expect(result.extension).toBe('txt');
    expect(result.extractionMethod).toBe('text');
    expect(result.textLength).toBeGreaterThan(0);
    expect(result.textExcerpt.length).toBeLessThanOrEqual(MAX_EXCERPT);
  });

  it('should parse CSV files', async () => {
    const csv = 'name,age,city\n张三,30,北京\n李四,25,上海';
    const file = createFile('data.csv', csv, 'text/csv');
    const result = await parseFile(file);
    
    expect(result.extractionMethod).toBe('text');
    expect(result.textExcerpt).toContain('张三');
  });

  it('should parse JSON files', async () => {
    const json = '{"name": "test", "value": 123}';
    const file = createFile('data.json', json, 'application/json');
    const result = await parseFile(file);
    
    expect(result.extractionMethod).toBe('text');
    expect(result.textExcerpt).toContain('test');
  });

  it('should truncate long text to MAX_EXCERPT', async () => {
    const longText = 'x'.repeat(MAX_EXCERPT * 2);
    const file = createFile('long.txt', longText);
    const result = await parseFile(file);
    
    expect(result.textExcerpt.length).toBeLessThanOrEqual(MAX_EXCERPT);
    expect(result.textLength).toBe(longText.length);
  });

  it('should handle empty file', async () => {
    const file = createFile('empty.txt', '');
    const result = await parseFile(file);
    
    expect(result.extractionMethod).toBe('text');
    expect(result.textExcerpt).toBe('');
    expect(result.textLength).toBe(0);
  });
});

describe('parseFiles (batch)', () => {
  it('should not fail if one file fails', async () => {
    const files = [
      createFile('good.txt', 'Hello'),
      createFile('bad.unknown', Buffer.from([0x00, 0x01, 0x02]), 'application/octet-stream'),
    ];
    
    const results = await parseFiles(files);
    
    expect(results).toHaveLength(2);
    expect(results[0].extractionMethod).toBe('text');
    expect(results[1].extractionMethod).toBe('none');
  });

  it('should preserve all files even with errors', async () => {
    const files = [
      createFile('a.txt', 'content a'),
      createFile('b.txt', 'content b'),
      createFile('c.txt', 'content c'),
    ];
    
    const results = await parseFiles(files);
    
    expect(results).toHaveLength(3);
    results.forEach((r, i) => {
      expect(r.fileName).toBe(String.fromCharCode(97 + i) + '.txt');
    });
  });
});

describe('file extension handling', () => {
  it('should identify MD files', async () => {
    const file = createFile('readme.md', '# Title\n\nContent');
    const result = await parseFile(file);
    expect(result.extractionMethod).toBe('text');
  });

  it('should identify XML files', async () => {
    const file = createFile('data.xml', '<?xml version="1.0"?><root><item>test</item></root>');
    const result = await parseFile(file);
    expect(result.extractionMethod).toBe('text');
  });

  it('should identify code files', async () => {
    const file = createFile('script.py', 'print("hello")');
    const result = await parseFile(file);
    expect(result.extractionMethod).toBe('text');
  });

  it('should mark unsupported binary as none', async () => {
    const file = createFile('binary.exe', Buffer.from([0x4D, 0x5A, 0x90, 0x00]), 'application/x-executable');
    const result = await parseFile(file);
    expect(result.extractionMethod).toBe('none');
    expect(result.extractionError).toBeDefined();
  });
});

describe('integration with fixtures', () => {
  it('should parse existing TXT fixture', async () => {
    const filePath = path.join(FIXTURES_DIR, 'report.txt');
    const content = fs.readFileSync(filePath);
    const file = createFile('report.txt', content);
    const result = await parseFile(file);
    
    expect(result.extractionMethod).toBe('text');
    expect(result.textLength).toBeGreaterThan(0);
  });
});
