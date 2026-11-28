// A lifecycle written as flags (`timedOut`, `ended`, `finished`, …) set from callbacks is a state machine nobody wrote
// down: some combinations of flags can't be meant but can happen, and some event in some state has no outcome anyone
// chose. The bounded supervisor took five fixes that way, each for one such pair (docs/mistake-classes.md, `state`).
//
// So a lifecycle is a table: for each state, the state each event leads to, every event listed in every state, so
// ignoring an event is a choice written down too. A test can then go through every pair. `step` does what a move
// means (signal, report, clear a timer), from the event and the states it went from and to.

/** What's wrong with `table`: a state that doesn't list every event, or an event that leads to a state it doesn't have. */
export function tableProblems(table) {
	const states = Object.keys(table);
	const events = [...new Set(states.flatMap((state) => Object.keys(table[state])))];
	const problems = [];
	for (const state of states) {
		for (const event of events) {
			const to = table[state][event];
			if (to === undefined) problems.push(`${state} doesn't say where ${event} leads`);
			else if (!Object.hasOwn(table, to)) problems.push(`${event} in ${state} leads to ${to}, which isn't a state`);
		}
	}
	return problems;
}

/**
 * A machine on `table`, starting in `initial`. `send(event, ...args)` moves it as the table says, then calls
 * `step({ event, from, to, args })`. A table that isn't whole is refused when it's made, and an event it doesn't know
 * when it's sent.
 */
export function machine(table, initial, step) {
	const problems = tableProblems(table);
	if (!Object.hasOwn(table, initial)) problems.push(`it starts in ${initial}, which isn't a state`);
	if (problems.length > 0) throw new Error(`Not a whole state table: ${problems.join("; ")}`);
	let state = initial;
	return {
		get state() {
			return state;
		},
		send(event, ...args) {
			const from = state;
			const to = table[from][event];
			if (to === undefined) throw new Error(`No event ${event} in this table (in ${from})`);
			state = to;
			step({ event, from, to, args });
		},
	};
}
