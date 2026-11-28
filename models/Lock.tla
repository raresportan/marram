---- MODULE Lock ----
\* The state file's lock: withLock in packages/marram/src/core/owned.mjs.
\*
\* The lock is a folder of numbered generations, each holding its holder's marker. A process waits until no
\* generation is held (its holder runs), stages one of its own, renames it to one above every generation there (a
\* rename onto a name that's there fails), and then holds the lock only if no other generation is held, giving way
\* otherwise. Each action below is one step the code takes on the file system: a process may stop between any two
\* (TLA+ interleaves them however it can), and may die at any point (Crash). Its generations stay where they are, with
\* a marker naming a process that's gone.
\*
\* Mutex says no two running processes are ever in the critical section. Reading the generations and their markers is
\* one step here, where the code lists them and then reads each marker: a generation published after the listing is
\* one published later, and one removed before its marker is read reads as not held, as it is.
EXTENDS Naturals, FiniteSets

CONSTANTS Procs, MaxGen, Rounds, VerifyAfterPublish

None == "none"
Gens == 1..MaxGen

VARIABLES pc, alive, owner, nxt, mine, rounds
vars == <<pc, alive, owner, nxt, mine, rounds>>

Published == {g \in Gens : owner[g] # None}
\* Held: a generation whose marker names a process that runs.
Held == {g \in Published : alive[owner[g]]}
Max(S) == IF S = {} THEN 0 ELSE CHOOSE m \in S : \A x \in S : x <= m

TypeOK ==
    /\ pc \in [Procs -> {"idle", "wait", "stage", "rename", "verify", "cs", "dead"}]
    /\ alive \in [Procs -> BOOLEAN]
    /\ owner \in [Gens -> Procs \cup {None}]
    /\ nxt \in [Procs -> 0..MaxGen + 1]
    /\ mine \in [Procs -> 0..MaxGen]
    /\ rounds \in [Procs -> 0..Rounds]

Init ==
    /\ pc = [p \in Procs |-> "idle"]
    /\ alive = [p \in Procs |-> TRUE]
    /\ owner = [g \in Gens |-> None]
    /\ nxt = [p \in Procs |-> 0]
    /\ mine = [p \in Procs |-> 0]
    /\ rounds = [p \in Procs |-> 0]

\* withLock is called.
Start(p) ==
    /\ pc[p] = "idle" /\ rounds[p] < Rounds
    /\ pc' = [pc EXCEPT ![p] = "wait"]
    /\ UNCHANGED <<alive, owner, nxt, mine, rounds>>

\* while (before.some(held)) pause(): goes on once it reads no generation held.
Wait(p) ==
    /\ pc[p] = "wait" /\ Held = {}
    /\ pc' = [pc EXCEPT ![p] = "stage"]
    /\ UNCHANGED <<alive, owner, nxt, mine, rounds>>

\* Its generation staged, marker and all; next = the highest generation there, plus one.
Stage(p) ==
    /\ pc[p] = "stage"
    /\ nxt' = [nxt EXCEPT ![p] = Max(Published) + 1]
    /\ pc' = [pc EXCEPT ![p] = "rename"]
    /\ UNCHANGED <<alive, owner, mine, rounds>>

\* renameSync(staging, next): fails onto a generation that's there, and the process starts over.
Rename(p) ==
    /\ pc[p] = "rename" /\ nxt[p] <= MaxGen
    /\ IF owner[nxt[p]] = None
       THEN /\ owner' = [owner EXCEPT ![nxt[p]] = p]
            /\ mine' = [mine EXCEPT ![p] = nxt[p]]
            /\ pc' = [pc EXCEPT ![p] = IF VerifyAfterPublish THEN "verify" ELSE "cs"]
       ELSE /\ pc' = [pc EXCEPT ![p] = "wait"]
            /\ UNCHANGED <<owner, mine>>
    /\ UNCHANGED <<alive, nxt, rounds>>

\* Published: it holds the lock if no other generation is held, and otherwise removes its own and starts over.
Verify(p) ==
    /\ pc[p] = "verify"
    /\ IF \E g \in Held : g # mine[p]
       THEN /\ owner' = [owner EXCEPT ![mine[p]] = None]
            /\ pc' = [pc EXCEPT ![p] = "wait"]
       ELSE /\ pc' = [pc EXCEPT ![p] = "cs"]
            /\ UNCHANGED owner
    /\ UNCHANGED <<alive, nxt, mine, rounds>>

\* Holding the lock, it removes a generation that isn't held: a gone holder's, or one that gave way.
Clean(p) ==
    /\ pc[p] = "cs"
    /\ \E g \in Published \ Held :
          /\ g # mine[p]
          /\ owner' = [owner EXCEPT ![g] = None]
    /\ UNCHANGED <<pc, alive, nxt, mine, rounds>>

\* It lets go: its generation goes.
Release(p) ==
    /\ pc[p] = "cs"
    /\ owner' = [owner EXCEPT ![mine[p]] = None]
    /\ pc' = [pc EXCEPT ![p] = "idle"]
    /\ rounds' = [rounds EXCEPT ![p] = @ + 1]
    /\ UNCHANGED <<alive, nxt, mine>>

\* It dies, wherever it is: what it published stays, with its marker.
Crash(p) ==
    /\ alive[p]
    /\ alive' = [alive EXCEPT ![p] = FALSE]
    /\ pc' = [pc EXCEPT ![p] = "dead"]
    /\ UNCHANGED <<owner, nxt, mine, rounds>>

\* Every process done or dead: nothing more happens, which isn't a deadlock.
Done ==
    /\ \A p \in Procs : pc[p] = "dead" \/ (pc[p] = "idle" /\ rounds[p] = Rounds)
    /\ UNCHANGED vars

Next ==
    \/ \E p \in Procs : Start(p) \/ Wait(p) \/ Stage(p) \/ Rename(p) \/ Verify(p) \/ Clean(p) \/ Release(p) \/ Crash(p)
    \/ Done

Spec == Init /\ [][Next]_vars

\* No two running processes are in the critical section at once.
Mutex == Cardinality({p \in Procs : pc[p] = "cs" /\ alive[p]}) <= 1

\* The bound of the search (CONSTRAINT): numbers past MaxGen aren't explored.
Bounded == \A p \in Procs : nxt[p] <= MaxGen
====
