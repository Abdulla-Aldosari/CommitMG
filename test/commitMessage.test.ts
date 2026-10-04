// Unit tests for the pure commit message generator (commitMessage.ts).
// Runs via mocha + ts-node (see .mocharc.json).

import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { FileChange, generateCommitMessage } from '../src/commitMessage';

const change = (path: string, kind: FileChange['kind'] = 'modified'): FileChange => ({ path, kind });

describe('generateCommitMessage', () => {
  it('returns an empty message when there are no changes', () => {
    assert.equal(generateCommitMessage([]), '');
  });

  it('infers feat for an added source file and uses the file name as scope', () => {
    assert.equal(
      generateCommitMessage([change('src/feature.ts', 'added')]),
      'feat(feature): add feature.ts'
    );
  });

  it('infers fix for a modified source file', () => {
    assert.equal(
      generateCommitMessage([change('src/extension.ts', 'modified')]),
      'fix(extension): update extension.ts'
    );
  });

  it('infers refactor when all source changes are deletions', () => {
    assert.equal(
      generateCommitMessage([change('src/legacy.ts', 'deleted')]),
      'refactor(legacy): remove legacy.ts'
    );
  });

  it('uses the rename verb for renamed files', () => {
    assert.equal(
      generateCommitMessage([change('src/old.ts', 'renamed')]),
      'fix(old): rename old.ts'
    );
  });

  it('infers docs when every change touches documentation', () => {
    assert.equal(
      generateCommitMessage([
        change('docs/README.md', 'modified'),
        change('CHANGELOG.md', 'modified'),
      ]),
      'docs: update README.md and CHANGELOG.md\n\n- Update docs/README.md\n- Update CHANGELOG.md'
    );
  });

  it('infers test when every change touches tests', () => {
    assert.equal(
      generateCommitMessage([change('test/unit.test.ts', 'modified')]),
      'test(unit): update unit.test.ts'
    );
  });

  it('infers ci for changes under .github', () => {
    assert.equal(
      generateCommitMessage([change('.github/workflows/release.yml', 'added')]),
      'ci(release): add release.yml'
    );
  });

  it('infers style for stylesheet-only changes', () => {
    assert.equal(
      generateCommitMessage([change('styles/app.css', 'modified')]),
      'style(app): update app.css'
    );
  });

  it('infers chore for build/config files', () => {
    assert.equal(
      generateCommitMessage([change('package.json', 'modified')]),
      'chore(package): update package.json'
    );
  });

  it('summarizes more than three files without a scope', () => {
    assert.equal(
      generateCommitMessage([
        change('src/a.ts', 'added'),
        change('lib/b.ts', 'added'),
        change('docs/c.ts', 'added'),
        change('src/d.ts', 'added'),
      ]),
      'feat: add 4 files\n\n- Add src/a.ts\n- Add lib/b.ts\n- Add docs/c.ts\n- Add src/d.ts'
    );
  });

  it('combines a shared scope and lists each file in the body', () => {
    assert.equal(
      generateCommitMessage([
        change('src/a.ts', 'added'),
        change('src/b.ts', 'modified'),
      ]),
      'feat(src): update a.ts and b.ts\n\n- Add src/a.ts\n- Update src/b.ts'
    );
  });

  it('de-duplicates the same path appearing in several change groups', () => {
    assert.equal(
      generateCommitMessage([
        change('src/a.ts', 'added'),
        change('src/a.ts', 'modified'),
      ]),
      'fix(a): update a.ts'
    );
  });
});
