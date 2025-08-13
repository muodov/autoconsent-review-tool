/*
  Autoconsent CI Failure Reviewer
  - Accepts a Jenkins artifacts ZIP
  - Assumes ZIP structure under base prefix 'archive/':
    * Multiple results files at root: results-<region>.xml (also supports results.xml)
    * test-results/screenshots/ containing .jpg files
    * Screenshot filenames follow: "<testName>-<suffix>.jpg"
  - Parses all results files, groups failures by reason, and renders matching screenshots
*/

// JSZip is loaded globally via script tag in index.html

/** @typedef {{
 *  reason: string;
 *  url: string;
 *  cmp: string;
 *  autoAction: string;
 *  region: string;
 *  formFactor: string;
 *  testName: string;
 *  retry: number;
 * }} FailureStats
 */

/** @typedef {{
 *  testName: string;
 *  testFile: string;
 *  time: string;
 *  failureText: string;
 *  systemOut: string;
 *  systemErr: string;
 *  attachments: string[]; // paths from the ZIP
 *  failureStats: FailureStats[];
 * }} FailureItem
 */

/** @typedef {{ reason: string; items: FailureItem[] }} FailureGroup */

const els = {
  input: /** @type {HTMLInputElement} */ (document.getElementById('zipInput')),
  dropzone: /** @type {HTMLElement} */ (document.getElementById('dropzone')),
  summary: /** @type {HTMLElement} */ (document.getElementById('summary')),
  results: /** @type {HTMLElement} */ (document.getElementById('results')),
  groupTpl: /** @type {HTMLTemplateElement} */ (document.getElementById('group-template')),
  itemTpl: /** @type {HTMLTemplateElement} */ (document.getElementById('item-template')),
  modal: /** @type {HTMLElement} */ (document.getElementById('screenshot-modal')),
  modalImage: /** @type {HTMLImageElement} */ (document.querySelector('.modal-image')),
  modalCaption: /** @type {HTMLElement} */ (document.querySelector('.modal-caption')),
  modalClose: /** @type {HTMLElement} */ (document.querySelector('.modal-close')),
  modalBackdrop: /** @type {HTMLElement} */ (document.querySelector('.modal-backdrop')),
  globalRollback: /** @type {HTMLElement} */ (document.getElementById('global-rollback')),
  selectionCount: /** @type {HTMLElement} */ (document.getElementById('selection-count')),
  globalGitCommand: /** @type {HTMLElement} */ (document.getElementById('global-git-command')),
  globalCopyButton: /** @type {HTMLButtonElement} */ (document.getElementById('global-copy-button')),
};

/** @type {import('jszip')} */
let currentZip; // JSZip instance
const basePrefix = 'archive/'; // fixed prefix

// Global state for selected rollbacks and reviewed items
/** @type {Set<string>} */
const selectedTestFiles = new Set();
/** @type {Set<string>} */
const reviewedTestFiles = new Set();

function setup() {
    els.input.addEventListener('change', (e) => {
    const target = /** @type {HTMLInputElement} */ (e.target);
      const file = target.files && target.files[0];
      if (file) void handleZipFile(file);
    });

    ;['dragenter', 'dragover'].forEach((type) => {
      els.dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropzone.classList.add('dragover');
      });
    });
    ;['dragleave', 'drop'].forEach((type) => {
      els.dropzone.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        els.dropzone.classList.remove('dragover');
      });
    });
    els.dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) void handleZipFile(file);
    });

  // Setup modal functionality
  setupModal();

  // Setup global rollback functionality
  setupGlobalRollback();
}

function setupModal() {
  // Close modal when clicking close button
  els.modalClose.addEventListener('click', closeModal);

  // Close modal when clicking backdrop
  els.modalBackdrop.addEventListener('click', closeModal);

  // Close modal with ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

/**
 * @param {string} imageSrc
 * @param {string} caption
 */
function openModal(imageSrc, caption) {
  els.modalImage.src = imageSrc;
  els.modalCaption.textContent = caption;
  els.modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden'; // Prevent body scroll
}

function closeModal() {
  els.modal.classList.add('hidden');
  document.body.style.overflow = ''; // Restore body scroll
}

function setupGlobalRollback() {
  els.globalCopyButton.addEventListener('click', () => {
    const command = els.globalGitCommand.textContent;
    if (command && command !== 'No items selected') {
      navigator.clipboard.writeText(command).then(() => {
        els.globalCopyButton.textContent = 'Copied!';
        setTimeout(() => {
          els.globalCopyButton.textContent = 'Copy';
        }, 2000);
      }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = command;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        els.globalCopyButton.textContent = 'Copied!';
        setTimeout(() => {
          els.globalCopyButton.textContent = 'Copy';
        }, 2000);
      });
    }
  });
}

function updateGlobalRollback() {
  const selectedFiles = Array.from(selectedTestFiles);
  els.selectionCount.textContent = `${selectedFiles.length} selected`;

  if (selectedFiles.length === 0) {
    els.globalRollback.classList.add('hidden');
    els.globalGitCommand.textContent = 'No items selected';
    els.globalCopyButton.disabled = true;
  } else {
    els.globalRollback.classList.remove('hidden');
    const filesString = selectedFiles.map(file => `"${file}"`).join(' ');
    const command = `for file in ${filesString}; do git revert $(git log -n 1 --pretty=format:"%H" -- "$file"); done`;
    els.globalGitCommand.textContent = command;
    els.globalCopyButton.disabled = false;
  }
}

/**
 * @param {string} testFile
 * @param {boolean} isSelected
 */
function toggleTestFileSelection(testFile, isSelected) {
  if (isSelected) {
    selectedTestFiles.add(testFile);
    // If marking for rollback, remove from reviewed
    reviewedTestFiles.delete(testFile);
  } else {
    selectedTestFiles.delete(testFile);
  }
  updateItemState(testFile);
  updateGlobalRollback();
}

/**
 * @param {string} testFile
 * @param {boolean} isReviewed
 */
function toggleTestFileReviewed(testFile, isReviewed) {
  if (isReviewed) {
    reviewedTestFiles.add(testFile);
    // If marking as reviewed, remove from rollback
    selectedTestFiles.delete(testFile);
  } else {
    reviewedTestFiles.delete(testFile);
  }
  updateItemState(testFile);
  updateGlobalRollback();
}

/**
 * @param {string} testFile
 */
function updateItemState(testFile) {
  const isSelected = selectedTestFiles.has(testFile);
  const isReviewed = reviewedTestFiles.has(testFile);
  const isProcessed = isSelected || isReviewed;

  // Update checkboxes
  const rollbackCheckbox = /** @type {HTMLInputElement} */ (document.getElementById(`rollback-${testFile.replace(/[^a-zA-Z0-9]/g, '_')}`));
  const reviewedCheckbox = /** @type {HTMLInputElement} */ (document.getElementById(`reviewed-${testFile.replace(/[^a-zA-Z0-9]/g, '_')}`));

  if (rollbackCheckbox) rollbackCheckbox.checked = isSelected;
  if (reviewedCheckbox) reviewedCheckbox.checked = isReviewed;

  // Update item collapse state
  const itemElement = rollbackCheckbox?.closest('.item');
  if (itemElement) {
    itemElement.classList.toggle('collapsed', isProcessed);
    itemElement.classList.toggle('reviewed', isReviewed);
    itemElement.classList.toggle('rollback', isSelected);
  }
}

/**
 * @param {FailureGroup} group
 * @param {boolean} selectAll
 */
function toggleGroupSelection(group, selectAll) {
  const testFiles = [...new Set(group.items.map(item => item.testFile).filter(Boolean))];

  testFiles.forEach(testFile => {
    if (selectAll) {
      selectedTestFiles.add(testFile);
      // Remove from reviewed when selecting for rollback
      reviewedTestFiles.delete(testFile);
    } else {
      selectedTestFiles.delete(testFile);
    }

    // Update individual checkboxes and item state
    updateItemState(testFile);
  });

  updateGlobalRollback();
}

/**
 * @param {File} file
 */
async function handleZipFile(file) {
  clearUI();
  try {
    currentZip = await JSZip.loadAsync(file);
  } catch (/** @type {any} */ e) {
    notify(`Failed to read ZIP: ${e.message}`);
    return;
  }

  const resultFiles = listResultFiles(currentZip);
  if (!resultFiles.length) {
    notify(`No results XML files found under ${basePrefix} (expected files like results-US.xml)`);
    return;
  }

  const parser = new DOMParser();
  /** @type {FailureItem[]} */
  let failures = [];
  let totalTests = 0;
  let totalTime = 0;
  let testSuiteCount = 0;

  for (const path of resultFiles) {
    try {
      const xml = await currentZip.file(path)?.async('string');
      if (!xml) continue;
      const doc = parser.parseFromString(xml, 'application/xml');
      const err = doc.querySelector('parsererror');
      if (err) {
        console.warn('Failed to parse', path);
        continue;
      }
      failures = failures.concat(extractFailures(doc));
      const stats = extractStats(doc);
      totalTests += stats.testCount;
      totalTime += stats.timeSec;
      testSuiteCount += stats.testSuiteCount;
    } catch (e) {
      console.warn('Error reading', path, e);
    }
  }

  const screenshots = listScreenshots(currentZip);
  attachScreenshotsByPrefix(failures, screenshots);

  const groups = groupByReason(failures);
  renderSummary({ totalTests, totalTime, testSuiteCount}, failures, groups);
  renderGroups(groups);
}

function clearUI() {
    els.summary.classList.add('hidden');
    els.summary.textContent = '';
    els.results.innerHTML = '';
  els.globalRollback.classList.add('hidden');
  selectedTestFiles.clear();
  reviewedTestFiles.clear();
}

/**
 * @param {string} message
 */
function notify(message) {
    els.summary.classList.remove('hidden');
    els.summary.textContent = message;
}

/**
 * @param {XMLDocument} xmlDoc
 * @returns {FailureItem[]}
 */
function extractFailures(xmlDoc) {
  /** @type {FailureItem[]} */
  const failures = [];

  const testsuites = xmlDoc.querySelectorAll('testsuite');
  for (const ts of testsuites) {
    const testcases = Array.from(ts.querySelectorAll('testcase'));
    if(testcases.length > 1) {
      console.log('AAAAAAA');
      console.log(testcases);
    }
  for (const tc of testcases) {
    const systemErr = textContent(tc.querySelector('system-err'));
    const failureReportLines = systemErr.split('\n').filter(l => l.includes('Autoconsent test failed on'));
    /** @type {FailureStats[]} */
    const failureStats = [];
    for (const line of failureReportLines) {
      const jsonMatch = line.match(/failure stats: (.*)/);
      if (jsonMatch && jsonMatch[1]) {
        try {
          const stats = JSON.parse(jsonMatch[1]);
          // Clean up the reason text
          if (stats.reason) {
            stats.reason = stats.reason.split('\n')[0].trim();
          }
          failureStats.push(stats);
        } catch (e) {
          console.warn('Failed to parse failure stats JSON:', jsonMatch[1], e);
        }
      }
    }

    /** @type {FailureItem} */
    const item = {
      failureStats,
      testName: (tc.getAttribute('name') || '').replace(/^.* › /g, ''), // remove leading "testSuite › " prefix
      testFile: tc.getAttribute('classname') || '',
      time: tc.getAttribute('time') || '',
        failureText: textContent(tc.querySelector('failure')),
      systemOut: textContent(tc.querySelector('system-out')),
      systemErr,
      attachments: [],
    };
    failures.push(item);
  }
  }

  return failures;
}

/**
 * @param {Element | null} el
 * @returns {string}
 */
function textContent(el) {
  return el ? (el.textContent || '').trim() : '';
}

/**
 * @param {XMLDocument} xmlDoc
 * @returns {{testCount: number, timeSec: number, testSuiteCount: number}}
 */
function extractStats(xmlDoc) {
  const root = xmlDoc.documentElement; // testsuites or testsuite
  let testCount = 0;
  let timeSec = 0;
  const testSuiteCount = xmlDoc.querySelectorAll('testsuite').length;
  const testsAttr = Number(root.getAttribute('tests') || 0);
  if (testsAttr > 0) testCount = testsAttr; else testCount = xmlDoc.querySelectorAll('testcase').length;
  const timeAttr = Number(root.getAttribute('time') || 0);
  if (!Number.isNaN(timeAttr) && timeAttr > 0) timeSec = timeAttr;
  return { testCount, timeSec, testSuiteCount };
}

/**
 * @param {import('jszip')} zip
 * @returns {string[]}
 */
function listScreenshots(zip) {
  const dir = basePrefix + 'test-results/screenshots/';
  const files = Object.keys(zip.files);
  const shots = files.filter((p) => p.startsWith(dir) && p.toLowerCase().endsWith('.jpg'));
  if (!shots.length) notify(`No .jpg screenshots found in ${dir}`);
  return shots;
}

/**
 * @param {import('jszip')} zip
 * @returns {string[]}
 */
function listResultFiles(zip) {
  const files = Object.keys(zip.files);
  // Include results.xml and results-*.xml under basePrefix
  return files.filter((p) => p.startsWith(basePrefix) && /results(-[A-Za-z0-9_]+)?\.xml$/i.test(p.slice(basePrefix.length)));
}

/**
 * @param {FailureItem[]} failures
 * @param {string[]} screenshotPaths
 */
function attachScreenshotsByPrefix(failures, screenshotPaths) {
  // For each failure, collect screenshots whose base filename starts with `${testName}-`
  for (const f of failures) {
    const prefix = f.testName + '-';
    const matches = screenshotPaths.filter((p) => {
      const base = basename(p);
      return base.startsWith(prefix);
    });
    f.attachments = matches;
  }
}

/**
 * @param {string} p
 */
function basename(p) {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * @param {FailureItem[]} failures
 */
function groupByReason(failures) {
  /** @type {Map<string, FailureItem[]>} */
  const map = new Map();
  for (const f of failures) {
    const reason = computeReason(f);
    if (!map.has(reason)) map.set(reason, []);
    // @ts-expect-error it's set by now
    map.get(reason).push(f);
  }
  return Array.from(map.entries()).map(([reason, items]) => ({ reason, items }));
}

/**
 * @param {FailureItem} f
 */
function isFailure(f) {
  return f.failureStats.length > 0 || f.failureText;
}

/**
 * @param {FailureItem} f
 */
function computeReason(f) {
  if (!isFailure(f)) return 'Success';
  const reason = f.failureStats[0]?.reason || f.failureText.match(/\n\s+Error: (.*)\n/)?.[1] || f.failureText || 'Unknown failure';
  return reason;
}

/**
 * @param {{totalTests: number, totalTime: number, testSuiteCount: number}} stats
 * @param {FailureItem[]} failures
 * @param {FailureGroup[]} groups
 */
function renderSummary(stats, failures, groups) {
  const failed = failures.filter(isFailure).length;
  const succeeded = failures.filter(f => !isFailure(f)).length;
  let timeStr = '';
  if (stats.totalTime) {
    const totalSeconds = Math.floor(stats.totalTime);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    timeStr = ` — Time: ${parts.join(' ')}`;
  }
  els.summary.classList.remove('hidden');
  els.summary.innerHTML = `Test suites: <span class="badge">${stats.testSuiteCount}</span> — Total tests: <span class="badge">${stats.totalTests}</span> — Successes: <span class="badge">${succeeded}</span> — Failures: <span class="badge danger">${failed}</span> — Groups: <span class="badge">${groups.length}</span>${timeStr}`;
}

/**
 * @param {FailureGroup[]} groups
 */
function renderGroups(groups) {
    els.results.innerHTML = '';

    // sort groups by size desc
    groups.sort((a, b) => b.items.length - a.items.length);

    for (const group of groups) {
    // @ts-expect-error we guarantee that the template has a firstElementChild
      const g = els.groupTpl.content.firstElementChild.cloneNode(true);
    // @ts-expect-error we guarantee that the element exists
      g.querySelector('.reason').textContent = group.reason;
    // @ts-expect-error we guarantee that the element exists
      g.querySelector('.count').textContent = `(${group.items.length})`;

    // Add group git revert command
    // @ts-expect-error we guarantee that the element exists
    const summaryEl = g.querySelector('summary');
    const testFiles = [...new Set(group.items.map(item => item.testFile).filter(Boolean))];

    // Add group select all checkbox
    if (testFiles.length > 0) {
      const groupSelectDiv = document.createElement('div');
      groupSelectDiv.className = 'group-select-all';

      const groupCheckbox = document.createElement('input');
      groupCheckbox.type = 'checkbox';
      groupCheckbox.className = 'group-select-checkbox';
      groupCheckbox.addEventListener('change', (e) => {
        e.stopPropagation(); // Prevent toggling the details
        toggleGroupSelection(group, groupCheckbox.checked);
      });

      const groupLabel = document.createElement('label');
      groupLabel.className = 'group-select-label';
      groupLabel.textContent = 'Select All';
      groupLabel.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent toggling the details
        groupCheckbox.checked = !groupCheckbox.checked;
        toggleGroupSelection(group, groupCheckbox.checked);
      });

      groupSelectDiv.appendChild(groupCheckbox);
      groupSelectDiv.appendChild(groupLabel);
      summaryEl.appendChild(groupSelectDiv);
    }



    // @ts-expect-error we guarantee that the element exists
      const itemsEl = g.querySelector('.items');
      for (const item of group.items) {
        itemsEl.appendChild(renderItem(item));
      }

      els.results.appendChild(g);
    }
  }

/**
 * Helper function to render stats grid HTML
 * @param {FailureStats} stats
 * @param {FailureItem} item
 * @param {boolean} showRetry
 * @returns {string}
 */
function renderStatsGrid(stats, item, showRetry = false) {
  return `
    <div class="stats-grid">
      ${showRetry ? `<div class="stats-row"><span class="stats-label">Retry:</span><span class="stats-value">${stats.retry}</span></div>` : ''}
      ${stats.url ? `<div class="stats-row"><span class="stats-label">URL:</span><a href="${stats.url}" class="stats-value">${stats.url}</a></div>` : ''}
      ${stats.cmp ? `<div class="stats-row"><span class="stats-label">Expected CMP:</span><span class="stats-value">${stats.cmp}</span></div>` : ''}
      ${stats.autoAction ? `<div class="stats-row"><span class="stats-label">Action:</span><span class="stats-value">${stats.autoAction}</span></div>` : ''}
      ${stats.region ? `<div class="stats-row"><span class="stats-label">Region:</span><span class="stats-value">${stats.region}</span></div>` : ''}
      ${stats.formFactor ? `<div class="stats-row"><span class="stats-label">Form Factor:</span><span class="stats-value">${stats.formFactor}</span></div>` : ''}
      ${item.testFile ? `<div class="stats-row"><span class="stats-label">Test File:</span><span class="stats-value">${item.testFile}</span></div>` : ''}
    </div>
  `;
}

/**
 * @param {FailureItem} item
 * @returns {HTMLElement}
 */
function renderItem(item) {
  // @ts-expect-error we guarantee that the template has a firstElementChild
  const el = /** @type {HTMLElement} */ (els.itemTpl.content.firstElementChild.cloneNode(true));
  // @ts-expect-error we guarantee that the element exists
  el.querySelector('.test-name').textContent = item.testName;
  // @ts-expect-error we guarantee that the element exists
  el.querySelector('.meta').textContent = `${item.testFile || ''} ${item.time ? '— ' + item.time + 's' : ''}`;

  // Add rollback and reviewed checkboxes if we have a test file
  if (item.testFile) {
    const headerEl = /** @type {HTMLElement} */ (el.querySelector('.item-header'));
    const checkboxesDiv = document.createElement('div');
    checkboxesDiv.className = 'item-checkboxes';

    // Rollback checkbox
    const rollbackDiv = document.createElement('div');
    rollbackDiv.className = 'rollback-checkbox';

    const rollbackCheckbox = document.createElement('input');
    rollbackCheckbox.type = 'checkbox';
    rollbackCheckbox.id = `rollback-${item.testFile.replace(/[^a-zA-Z0-9]/g, '_')}`;
    rollbackCheckbox.className = 'rollback-check';
    rollbackCheckbox.addEventListener('change', () => {
      toggleTestFileSelection(item.testFile, rollbackCheckbox.checked);
    });

    const rollbackLabel = document.createElement('label');
    rollbackLabel.htmlFor = rollbackCheckbox.id;
    rollbackLabel.className = 'rollback-label';
    rollbackLabel.textContent = 'Rollback';

    rollbackDiv.appendChild(rollbackCheckbox);
    rollbackDiv.appendChild(rollbackLabel);

    // Reviewed checkbox
    const reviewedDiv = document.createElement('div');
    reviewedDiv.className = 'reviewed-checkbox';

    const reviewedCheckbox = document.createElement('input');
    reviewedCheckbox.type = 'checkbox';
    reviewedCheckbox.id = `reviewed-${item.testFile.replace(/[^a-zA-Z0-9]/g, '_')}`;
    reviewedCheckbox.className = 'reviewed-check';
    reviewedCheckbox.addEventListener('change', () => {
      toggleTestFileReviewed(item.testFile, reviewedCheckbox.checked);
    });

    const reviewedLabel = document.createElement('label');
    reviewedLabel.htmlFor = reviewedCheckbox.id;
    reviewedLabel.className = 'reviewed-label';
    reviewedLabel.textContent = 'Reviewed';

    reviewedDiv.appendChild(reviewedCheckbox);
    reviewedDiv.appendChild(reviewedLabel);

    checkboxesDiv.appendChild(reviewedDiv);
    checkboxesDiv.appendChild(rollbackDiv);
    headerEl.appendChild(checkboxesDiv);
  }

  // Render failure stats
  const statsEl = /** @type {HTMLElement} */ (el.querySelector('.failure-stats'));
  if (item.failureStats && item.failureStats.length) {
    // Separate initial stats (retry 0 or undefined) from retry stats
    const initialStats = item.failureStats.filter(stats => !stats.retry || stats.retry === 0);
    const retryStats = item.failureStats.filter(stats => stats.retry && stats.retry > 0);

    // Render initial stats (always visible)
    for (const stats of initialStats) {
      const statsDiv = document.createElement('div');
      statsDiv.className = 'stats-item';
      statsDiv.innerHTML = renderStatsGrid(stats, item, false);
      statsEl.appendChild(statsDiv);
    }

    // Render retry stats under a dropdown if they exist
    if (retryStats.length > 0) {
      const retryDropdown = document.createElement('details');
      retryDropdown.className = 'retry-dropdown';

      const retrySummary = document.createElement('summary');
      retrySummary.className = 'retry-summary';
      retrySummary.textContent = `Retries (${retryStats.length})`;

      const retryContent = document.createElement('div');
      retryContent.className = 'retry-content';

      for (const stats of retryStats) {
        const statsDiv = document.createElement('div');
        statsDiv.className = 'stats-item retry-stats-item';
        statsDiv.innerHTML = renderStatsGrid(stats, item, true);
        retryContent.appendChild(statsDiv);
      }

      retryDropdown.appendChild(retrySummary);
      retryDropdown.appendChild(retryContent);
      statsEl.appendChild(retryDropdown);
    }
  }

    // Add separate dropdowns for different types of error information

  // Failure Text dropdown
  if (item.failureText) {
    const failureDropdown = document.createElement('details');
    failureDropdown.className = 'failure-text-dropdown';

    const failureSummary = document.createElement('summary');
    failureSummary.className = 'failure-text-summary';
    failureSummary.textContent = 'Failure Details';

    const failureContent = document.createElement('div');
    failureContent.className = 'failure-text-content';

    const failurePre = document.createElement('pre');
    failurePre.className = 'failure-text-pre';
    failurePre.textContent = item.failureText;
    failureContent.appendChild(failurePre);

    failureDropdown.appendChild(failureSummary);
    failureDropdown.appendChild(failureContent);
    statsEl.appendChild(failureDropdown);
  }

  // System Error dropdown
  if (item.systemErr) {
    const systemErrDropdown = document.createElement('details');
    systemErrDropdown.className = 'failure-text-dropdown system-err-dropdown';

    const systemErrSummary = document.createElement('summary');
    systemErrSummary.className = 'failure-text-summary system-err-summary';
    systemErrSummary.textContent = 'Stderr';

    const systemErrContent = document.createElement('div');
    systemErrContent.className = 'failure-text-content';

    const systemErrPre = document.createElement('pre');
    systemErrPre.className = 'failure-text-pre';
    systemErrPre.textContent = item.systemErr;
    systemErrContent.appendChild(systemErrPre);

    systemErrDropdown.appendChild(systemErrSummary);
    systemErrDropdown.appendChild(systemErrContent);
    statsEl.appendChild(systemErrDropdown);
  }

  // System Output dropdown
  if (item.systemOut) {
    const systemOutDropdown = document.createElement('details');
    systemOutDropdown.className = 'failure-text-dropdown system-out-dropdown';

    const systemOutSummary = document.createElement('summary');
    systemOutSummary.className = 'failure-text-summary system-out-summary';
    systemOutSummary.textContent = 'Stdout';

    const systemOutContent = document.createElement('div');
    systemOutContent.className = 'failure-text-content';

    const systemOutPre = document.createElement('pre');
    systemOutPre.className = 'failure-text-pre';
    systemOutPre.textContent = item.systemOut;
    systemOutContent.appendChild(systemOutPre);

    systemOutDropdown.appendChild(systemOutSummary);
    systemOutDropdown.appendChild(systemOutContent);
    statsEl.appendChild(systemOutDropdown);
  }

  // Add git revert command if we have a test file
  if (item.testFile) {
    const gitRevertDiv = document.createElement('div');
    gitRevertDiv.className = 'git-revert-section';

    const gitLabel = document.createElement('div');
    gitLabel.className = 'git-revert-label';
    gitLabel.textContent = 'Revert last commit for this test:';

    const gitCodeDiv = document.createElement('div');
    gitCodeDiv.className = 'git-revert-code';

    const gitCommand = `git revert $(git log -n 1 --pretty=format:"%H" -- ${item.testFile})`;
    const gitCode = document.createElement('code');
    gitCode.className = 'git-command';
    gitCode.textContent = gitCommand;

    const copyButton = document.createElement('button');
    copyButton.className = 'git-copy-button';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', () => {
      navigator.clipboard.writeText(gitCommand).then(() => {
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      }).catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = gitCommand;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 2000);
      });
    });

    gitCodeDiv.appendChild(gitCode);
    gitCodeDiv.appendChild(copyButton);
    gitRevertDiv.appendChild(gitLabel);
    gitRevertDiv.appendChild(gitCodeDiv);
    statsEl.appendChild(gitRevertDiv);
  }

  // Render screenshots with names
  const screenshotsEl = /** @type {HTMLElement} */ (el.querySelector('.screenshots'));
  if (item.attachments && item.attachments.length) {
    for (const path of item.attachments) {
      const screenshotDiv = document.createElement('div');
      screenshotDiv.className = 'screenshot-item';

      const nameDiv = document.createElement('div');
      nameDiv.className = 'screenshot-name';
      // Remove test name prefix from screenshot name (e.g., "testName-suffix.jpg" becomes "suffix.jpg")
      const fileName = basename(path);
      const cleanName = fileName.startsWith(item.testName + '-')
        ? fileName.slice(item.testName.length + 1)
        : fileName;
      nameDiv.textContent = cleanName;

      const imageEl = renderMedia(path);
      imageEl.className = 'screenshot-image';

      // Add click handler for zoom functionality
      imageEl.addEventListener('click', () => {
        void loadBlobUrl(path).then((url) => {
          if (url) openModal(url, cleanName);
        });
      });

      screenshotDiv.appendChild(nameDiv);
      screenshotDiv.appendChild(imageEl);
      screenshotsEl.appendChild(screenshotDiv);
    }
  }
  return el;
}



/**
 * @param {string} zipPath
 * @returns {HTMLElement}
 */
function renderMedia(zipPath) {
  const lower = zipPath.toLowerCase();
  if (lower.endsWith('.jpg')) {
    const img = document.createElement('img');
    img.alt = zipPath;
    void loadBlobUrl(zipPath).then((url) => (img.src = url));
    return img;
  }
  const a = document.createElement('a');
  a.textContent = zipPath;
  a.href = '#';
  void loadBlobUrl(zipPath).then((url) => (a.href = url));
  return a;
}

/**
 * @param {string} path
 * @returns {Promise<string>}
 */
async function loadBlobUrl(path) {
  try {
    const file = currentZip.file(path);
    if (!file) return '';
    const blob = await file.async('blob');
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn('Failed to load', path, e);
    return '';
  }
}

// init
setup();


