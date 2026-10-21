const $ = (selector) => document.querySelector(selector);
const workspaces = [...document.querySelectorAll('.tool-workspace')];

document.querySelectorAll('[data-open]').forEach((button) => {
  button.addEventListener('click', () => {
    workspaces.forEach((workspace) => workspace.hidden = workspace.id !== button.dataset.open);
    const active = document.getElementById(button.dataset.open);
    active.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => {
  button.closest('.tool-workspace').hidden = true;
}));

const jsonInput = $('#json-input');
const jsonOutput = $('#json-output');
const jsonStatus = $('#json-status');
function parseJson() {
  try {
    return { value: JSON.parse(jsonInput.value), error: null };
  } catch (error) {
    return { value: null, error };
  }
}
$('#format-json').addEventListener('click', () => {
  const result = parseJson();
  if (result.error) {
    jsonStatus.textContent = `JSON 有语法错误：${result.error.message}`;
    jsonStatus.style.color = '#b34e37';
    return;
  }
  jsonOutput.value = JSON.stringify(result.value, null, 2);
  jsonStatus.textContent = '格式正确，已完成格式化。内容仅在本地处理。';
  jsonStatus.style.color = '';
});
$('#minify-json').addEventListener('click', () => {
  const result = parseJson();
  if (result.error) {
    jsonStatus.textContent = `JSON 有语法错误：${result.error.message}`;
    jsonStatus.style.color = '#b34e37';
    return;
  }
  jsonOutput.value = JSON.stringify(result.value);
  jsonStatus.textContent = '格式正确，已压缩 JSON。';
  jsonStatus.style.color = '';
});
$('#copy-json').addEventListener('click', async () => {
  if (!jsonOutput.value) {
    jsonStatus.textContent = '请先生成结果，再复制。';
    return;
  }
  try {
    await navigator.clipboard.writeText(jsonOutput.value);
    jsonStatus.textContent = '已复制到剪贴板。';
  } catch {
    jsonOutput.focus();
    jsonOutput.select();
    jsonStatus.textContent = '浏览器未允许自动复制，已选中结果，请手动复制。';
  }
});

const textInput = $('#text-input');
function updateStats() {
  const text = textInput.value;
  $('#stat-chars').textContent = [...text].length.toLocaleString('zh-CN');
  $('#stat-no-space').textContent = [...text.replace(/\s/g, '')].length.toLocaleString('zh-CN');
  const trimmed = text.trim();
  $('#stat-words').textContent = (trimmed ? (trimmed.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length : 0).toLocaleString('zh-CN');
  $('#stat-lines').textContent = (text ? text.split(/\r\n|\r|\n/).length : 0).toLocaleString('zh-CN');
}
textInput.addEventListener('input', updateStats);
$('#year').textContent = new Date().getFullYear();
