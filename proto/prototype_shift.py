import random
import math
import time

REST = 0

def make_labels(n):
    if n == 1:
        return ["日勤"]
    if n == 2:
        return ["早", "遅"]
    return ["早"] + [f"中{i+1}" for i in range(n - 2)] + ["遅"]


W_CONSEC   = 5000.0
W_INTERVAL = 3000.0
W_SHIFTVAR = 40.0
W_RESTGAP  = 8.0
W_SAME3    = 4.0


class Solver:
    def __init__(self, P, S, D, max_consec=6, seed=0):
        self.P, self.S, self.D = P, S, D
        self.max_consec = max_consec
        self.rng = random.Random(seed)
        self.labels = make_labels(S)
        self.column = self._build_column()

    def _build_column(self):
        P, S = self.P, self.S
        rest = round(P * 2 / 7)
        workers = P - rest
        if workers < S:
            workers = S
            rest = P - S
        col = [1 + (i % S) for i in range(workers)] + [REST] * rest
        return col

    def feasible(self):
        if self.P < self.S:
            return False, f"人数({self.P})がシフト数({self.S})より少ないため、全シフトを埋められません"
        return True, ""

    def initial(self):
        return [[self.column[p]] * self.D for p in range(self.P)]

    def row_cost(self, row):
        D, S = self.D, self.S
        c = 0.0
        run = 0
        same = 1
        rests = []
        cnt = [0] * (S + 1)
        for d in range(D):
            v = row[d]
            cnt[v] += 1
            if v == REST:
                run = 0
                rests.append(d)
            else:
                run += 1
                if run > self.max_consec:
                    c += W_CONSEC
            if d > 0:
                if S >= 2 and row[d-1] == S and v == 1:
                    c += W_INTERVAL
                if v != REST and v == row[d-1]:
                    same += 1
                    if same >= 3:
                        c += W_SAME3
                else:
                    same = 1
        n = len(rests)
        if n >= 2:
            gaps = [rests[i+1]-rests[i] for i in range(n-1)]
            m = sum(gaps)/len(gaps)
            c += W_RESTGAP * (sum((g-m)**2 for g in gaps)/len(gaps))
        m = sum(cnt)/len(cnt)
        c += W_SHIFTVAR * (sum((x-m)**2 for x in cnt)/len(cnt))
        return c

    def solve(self, time_limit=3.0, patience=8, min_improve_ratio=0.001,
              min_rounds=40, max_rounds=400):
        """
        1ラウンド = P*D 回の交換試行（全セルを一巡する規模）
        patience ラウンド連続で改善率が min_improve_ratio 未満なら打ち切り。
        ただし min_rounds 未満では打ち切らない（温度が高いうちの誤判定を防ぐ）。
        温度はラウンド進捗に連動させ、max_rounds で冷却しきる。
        """
        ok, msg = self.feasible()
        if not ok:
            return None, msg

        P, S, D = self.P, self.S, self.D
        rng = self.rng
        grid = self.initial()
        row_costs = [self.row_cost(grid[p]) for p in range(P)]
        cur = sum(row_costs)
        best = cur
        best_grid = [r[:] for r in grid]

        round_size = max(2000, P * D)   # 1ラウンドの試行回数
        # 冷却しきるまでの反復数。問題規模に比例させる
        cool_iters = max(30000, P * D * 60)
        t0 = time.time()
        T_start, T_end = 300.0, 0.2
        it = 0
        stale = 0
        rounds = 0
        prev_best = best
        history = []

        while True:
            # --- 1ラウンド実行 ---
            for _ in range(round_size):
                frac = min(1.0, it / cool_iters)
                T = T_start * ((T_end/T_start) ** frac)
                it += 1
                d = rng.randrange(D)
                a, b = rng.randrange(P), rng.randrange(P)
                if a == b:
                    continue
                va, vb = grid[a][d], grid[b][d]
                if va == vb:
                    continue
                grid[a][d], grid[b][d] = vb, va
                na = self.row_cost(grid[a])
                nb = self.row_cost(grid[b])
                delta = (na - row_costs[a]) + (nb - row_costs[b])
                if delta <= 0 or rng.random() < math.exp(-delta/max(T,1e-9)):
                    row_costs[a], row_costs[b] = na, nb
                    cur += delta
                    if cur < best - 1e-9:
                        best = cur
                        best_grid = [r[:] for r in grid]
                else:
                    grid[a][d], grid[b][d] = va, vb

            rounds += 1
            improve = (prev_best - best) / max(abs(prev_best), 1.0)
            history.append((rounds, best, improve))
            if improve < min_improve_ratio:
                stale += 1
            else:
                stale = 0
            prev_best = best

            # 冷却が終わっていない間は「改善が止まった」判定をしない
            cooled = it >= cool_iters
            if cooled and stale >= patience:
                reason = f"収束({rounds}R)"
                break
            if rounds >= max_rounds:
                reason = f"上限到達({rounds}R)"
                break
            if time.time() - t0 > time_limit:
                reason = f"時間切れ({rounds}R)"
                break

        return (best_grid, best, it, time.time()-t0, reason, history), ""

    def stats(self, grid):
        P, S, D = self.P, self.S, self.D
        v = {"cover":0,"consec":0,"interval":0}
        for d in range(D):
            cnt=[0]*(S+1)
            for p in range(P): cnt[grid[p][d]] += 1
            for s in range(1,S+1):
                if cnt[s]==0: v["cover"] += 1
        works, lates = [], []
        for p in range(P):
            run=0
            for d in range(D):
                if grid[p][d]!=REST:
                    run+=1
                    if run>self.max_consec: v["consec"]+=1
                else: run=0
            if S>=2:
                for d in range(D-1):
                    if grid[p][d]==S and grid[p][d+1]==1: v["interval"]+=1
            works.append(sum(1 for d in range(D) if grid[p][d]!=REST))
            lates.append(sum(1 for d in range(D) if grid[p][d]==S))
        return v, works, lates


if __name__ == "__main__":
    print(f"{'ケース':<16}{'時間':>7}{'反復':>9}{'出勤幅':>7}{'遅番幅':>7}  停止理由")
    print("-"*70)
    for (P,S,D) in [(8,3,30),(12,4,30),(20,3,31),(50,4,31),(5,2,30),(30,5,31),(6,2,28)]:
        s = Solver(P,S,D,seed=1)
        res,msg = s.solve(time_limit=3.0, patience=8)
        if res is None:
            print(f"{P}人{S}シフト: 解なし({msg})"); continue
        grid,score,iters,el,reason,hist = res
        v,works,lates = s.stats(grid)
        vs = "OK" if sum(v.values())==0 else str(v)
        print(f"{P}人{S}シフト{D}日{'':<3}{el:>6.2f}s{iters:>9}{max(works)-min(works):>7}{max(lates)-min(lates):>7}  {reason} [{vs}]")
