// Posts the resource changes the PR's Bicep what-if previews beyond those main's own what-if previews, as a PR
// comment. What-if reports the same false positives (noise) for both, so comparing them leaves only the changes
// the PR makes. The comment also lists the resources in the resource group that the template doesn't define
// (orphaned-resources.sh), which a deployment leaves behind. When there are neither, no comment is created, and
// an earlier one (from a push that did have changes) is updated to say so, so it doesn't describe changes the PR
// no longer makes.
// Run from actions/github-script, which passes in `github` and `context`. WHAT_IF_OUTPUT and
// BASELINE_WHAT_IF_OUTPUT are the paths of the saved what-if output for the PR and for main, BASELINE_OK is
// 'true' if main's what-if succeeded (if not, every change is shown), and ORPHANED_RESOURCES is the path of the
// saved resource IDs the template doesn't define. AZURE_SUBSCRIPTION_ID is redacted.
const fs = require('fs');

// GitHub rejects comment bodies over 65,536 characters; leave room for the rest of the comment.
const maxOutputLength = 60000;

module.exports = async ({ github, context }) => {
  const marker = '<!-- flashcardsage-what-if -->';
  const baselineOk = process.env.BASELINE_OK === 'true';
  const changes = parseResourceChanges(readOutput(process.env.WHAT_IF_OUTPUT));
  const baseline = new Set(
    baselineOk ? parseResourceChanges(readOutput(process.env.BASELINE_WHAT_IF_OUTPUT)).map((c) => c.key) : [],
  );
  const prChanges = changes.filter((c) => !baseline.has(c.key));
  const orphans = readOutput(process.env.ORPHANED_RESOURCES)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((id) => id.replace(/^.*\/providers\//, ''));

  const { owner, repo } = context.repo;
  const issue_number = context.issue.number;
  const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number });
  const existing = comments.find((c) => c.user.type === 'Bot' && c.body.startsWith(marker));
  const sha = context.payload.pull_request.head.sha;
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

  if (prChanges.length === 0 && orphans.length === 0) {
    if (existing) {
      const body = [marker, '# Infrastructure What-If', `No infrastructure changes as of ${sha}.`].join('\n\n');
      await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    }
    return;
  }

  const body = [marker, '# Infrastructure What-If', describeChanges(prChanges, baselineOk, sha, runUrl)];
  if (orphans.length > 0) {
    body.push(
      '## Not in the template',
      `These resources are in the production resource group, but \`infra/main.bicep\` doesn't define them, so a ` +
        `deployment leaves them as they are. The \`deploy-infrastructure\` job deletes the alert rules among them ` +
        `after merging; anything else should be deleted by hand if it's no longer needed, or added to the template.`,
      '',
      ...orphans.map((resource) => `- \`${resource}\``),
    );
  }

  if (existing) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body: body.join('\n') });
  } else {
    await github.rest.issues.createComment({ owner, repo, issue_number, body: body.join('\n') });
  }
};

// The PR's changes under their scope (and section, for potential changes), as what-if lists them.
function describeChanges(prChanges, baselineOk, sha, runUrl) {
  if (prChanges.length === 0) {
    return `No infrastructure changes as of ${sha}.`;
  }
  const lines = [];
  let heading;
  for (const change of prChanges) {
    if (change.heading !== heading) {
      heading = change.heading;
      lines.push('', heading, '');
    }
    lines.push(change.text, '');
  }
  let shown = lines.join('\n').trim();
  if (shown.length > maxOutputLength) {
    shown = `${shown.slice(0, maxOutputLength)}\n... (truncated, see the workflow run for the full output)`;
  }
  const intro = baselineOk
    ? `Merging ${sha} would make these changes to the production infrastructure, leaving out those what-if also ` +
      `reports for main (mostly false positives)`
    : `Merging ${sha} would make these changes to the production infrastructure. What-if failed for main, so ` +
      `this also includes the false positives it reports for every PR`;
  return [`${intro} ([workflow run](${runUrl})):`, '```diff', toDiffHighlighting(shown), '```'].join('\n');
}

function readOutput(path) {
  let output = fs.readFileSync(path, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');
  if (process.env.AZURE_SUBSCRIPTION_ID) {
    output = output.replaceAll(process.env.AZURE_SUBSCRIPTION_ID, '<subscription-id>');
  }
  return output;
}

// Splits what-if output into one entry per resource change. Each starts with an indented change symbol and the
// resource ID (e.g. "  ~ Microsoft.Web/sites/FlashCardSage [2024-11-01]") and runs until the next one or the next
// unindented line, which is a scope ("Scope: ..."), stats ("Resource changes: ...") or other section line. The
// symbol legend before the first scope looks like a change too, so it's skipped.
function parseResourceChanges(output) {
  const changes = [];
  let scope;
  let section = '';
  let current;
  for (const line of output.split('\n')) {
    if (/^\S/.test(line)) {
      current = undefined;
      if (line.startsWith('Scope:')) {
        scope = line.trim();
      } else if (line.startsWith('Resource changes:')) {
        // Anything after the definite changes' stats line is a potential change.
        section = 'Potential changes:\n';
      }
    } else if (scope && /^ {2}[-+~=*x!] \S/.test(line)) {
      current = { heading: `${section}${scope}`, lines: [line] };
      changes.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return changes.map(({ heading, lines }) => {
    const text = lines.join('\n').trimEnd();
    return { heading, text, key: `${heading}\n${text}` };
  });
}

// What-if indents its change symbols (+ create, - delete, ~ modify, ...), but GitHub's diff highlighting only
// colors lines that start with + or -, so move each line's symbol to the start of the line.
function toDiffHighlighting(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/^(\s+)([-+~=*x!])(\s)/, '$2$1$3'))
    .join('\n');
}
