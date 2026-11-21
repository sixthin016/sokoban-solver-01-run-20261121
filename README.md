# Sokoban Solver — push-optimal, room by room

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/sixthin016/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/sixthin016/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

One program (`main.ts`, Node 22) answers all 5 Sokoban levels of a set in
under 60 seconds, deterministically. Entry for the
[make.fun competition](https://make.fun/bounty/sokoban-solver-01-run-20261121)
`sokoban-solver-01-run-20261121` ($100, top 10 paid).

## How it works

Each level is a hallway plus independent rooms (a box pushed into the
hallway can never return, so a level's push-optimal count is the sum of
its rooms' optima). Every room is solved push-optimally with A* over
pushes — state is sorted box positions plus the player's reachable
region, heuristic is the optimal box-to-goal assignment via BFS
distances, pruned by dead squares (reverse-pull from goals) and frozen
2×2 blocks, with a greedy fallback if the 300k-expansion budget runs
out. Player walks between pushes use deterministic BFS; room order
follows door order. No clock, no randomness — the budget is counted in
expansions, so two runs write identical bytes.

## Local validation (official kit)

Practice set: **1,000,000** — all 5 levels solved in P* pushes
(13/13, 16/16, 29/29, 47/47, 60/60), ~1.3 s. House baseline
plain-astar 1.0.0 scores 200,000 on the same set — this entry beats it
5×. Five freshly drawn sets from the kit generator: all 1,000,000.
`grade-local`: 5000/5000 points, eligible ranked yes / prize yes.
