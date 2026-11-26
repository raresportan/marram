import { execFileSync } from "node:child_process";
import { posix, relative, resolve, sep } from "node:path";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();

/**
 * `repo` at `revision`, checked out in `dir`: a clone of its own, so what runs there can't touch the caller's refs,
 * config, hooks or worktrees. --shared borrows the objects instead of copying them.
 */
export function checkoutAt(repo, revision, dir) {
	clone(repo, dir);
	git(dir, "-c", "core.hooksPath=/dev/null", "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", revision);
}

/** The tree `tree` of `repo` (a working tree's, from gate-state's treeOf, say) checked out in `dir`, in a clone of its own. */
export function checkoutTree(repo, tree, dir) {
	clone(repo, dir);
	git(dir, "read-tree", tree);
	git(dir, "checkout-index", "-a", "-f");
}

/**
 * A clone of `repo` in `dir`, not yet checked out. Its files are checked out as the repository holds them, without
 * line-ending conversion (core.autocrlf, on by default on Windows), so a patch made with git diff applies to them.
 */
function clone(repo, dir) {
	git(repo, "clone", "-q", "--shared", "--no-checkout", "-c", "core.autocrlf=false", "--", repo, dir);
}

/**
 * `path` (from `root`, a folder in a git repository) as git names it: from the repository's root, with forward
 * slashes; ".." or "../…" when it's outside. git says where `root` is in the repository, rather than its root being
 * compared with `root`, which another spelling of the same folder (a Windows short name, a link) wouldn't match.
 */
export function repoPath(root, path = ".") {
	const prefix = git(root, "rev-parse", "--show-prefix");
	return posix.normalize(posix.join(prefix, relative(root, resolve(root, path)).split(sep).join("/"))).replace(/(.)\/$/, "$1");
}
