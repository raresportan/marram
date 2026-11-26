import { execFileSync } from "node:child_process";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();

/**
 * `repo` at `revision`, checked out in `dir`: a clone of its own, so what runs there can't touch the caller's refs,
 * config, hooks or worktrees. --shared borrows the objects instead of copying them.
 */
export function checkoutAt(repo, revision, dir) {
	git(repo, "clone", "-q", "--shared", "--no-checkout", "--", repo, dir);
	git(dir, "-c", "core.hooksPath=/dev/null", "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", revision);
}

/** The tree `tree` of `repo` (a working tree's, from gate-state's treeOf, say) checked out in `dir`, in a clone of its own. */
export function checkoutTree(repo, tree, dir) {
	git(repo, "clone", "-q", "--shared", "--no-checkout", "--", repo, dir);
	git(dir, "read-tree", tree);
	git(dir, "checkout-index", "-a", "-f");
}
