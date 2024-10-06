---
title: 도넛과 막대 그래프
categories: [coding test, 2024 kakao winter internship]
tags: [coding test, 2024 kakao winter internship] # TAG names should always be lowercase
sitemap:
  changefreq: daily
  priority: 1.0
---

## 출처 [프로그래머스](https://school.programmers.co.kr/learn/courses/30/lessons/258711)

### 문제 설명
도넛 모양 그래프, 막대 모양 그래프, 8자 모양 그래프들이 있습니다. 

이 그래프들은 1개 이상의 정점과, 정점들을 연결하는 단방향 간선으로 이루어져 있습니다.

크기가 n인 도넛 모양 그래프는 n개의 정점과 n개의 간선이 있습니다. 

도넛 모양 그래프의 아무 한 정점에서 출발해 이용한 적 없는 간선을 계속 따라가면 나머지 n-1개의 정점들을 한 번씩 방문한 뒤 원래 출발했던 정점으로 돌아오게 됩니다. 도넛 모양 그래프의 형태는 다음과 같습니다.

![image](/assets/images/2024_kakao_winter_internship/Donuts_and_bar_graphs/image.png)

크기가 n인 막대 모양 그래프는 n개의 정점과 n-1개의 간선이 있습니다. 

막대 모양 그래프는 임의의 한 정점에서 출발해 간선을 계속 따라가면 나머지 n-1개의 정점을 한 번씩 방문하게 되는 정점이 단 하나 존재합니다. 막대 모양 그래프의 형태는 다음과 같습니다.

![image](/assets/images/2024_kakao_winter_internship/Donuts_and_bar_graphs/image-1.png)

크기가 n인 8자 모양 그래프는 2n+1개의 정점과 2n+2개의 간선이 있습니다.

8자 모양 그래프는 크기가 동일한 2개의 도넛 모양 그래프에서 정점을 하나씩 골라 결합시킨 형태의 그래프입니다. 8자 모양 그래프의 형태는 다음과 같습니다.

![image](/assets/images/2024_kakao_winter_internship/Donuts_and_bar_graphs/image-2.png)

도넛 모양 그래프, 막대 모양 그래프, 8자 모양 그래프가 여러 개 있습니다. 이 그래프들과 무관한 정점을 하나 생성한 뒤, 각 도넛 모양 그래프, 막대 모양 그래프, 8자 모양 그래프의 임의의 정점 하나로 향하는 간선들을 연결했습니다.

그 후 각 정점에 서로 다른 번호를 매겼습니다.

이때 당신은 그래프의 간선 정보가 주어지면 생성한 정점의 번호와 정점을 생성하기 전 도넛 모양 그래프의 수, 막대 모양 그래프의 수, 8자 모양 그래프의 수를 구해야 합니다.

그래프의 간선 정보를 담은 2차원 정수 배열 edges가 매개변수로 주어집니다.

이때, 생성한 정점의 번호, 도넛 모양 그래프의 수, 막대 모양 그래프의 수, 8자 모양 그래프의 수를 순서대로 1차원 정수 배열에 담아 return 하도록 solution 함수를 완성해 주세요.

---
### 제한사항
* 1 ≤ edges의 길이 ≤ 1,000,000
	* edges의 원소는 [a,b] 형태이며, a번 정점에서 b번 정점으로 향하는 간선이 있다는 것을 나타냅니다.
	* 1 ≤ a, b ≤ 1,000,000
* 문제의 조건에 맞는 그래프가 주어집니다.
* 도넛 모양 그래프, 막대 모양 그래프, 8자 모양 그래프의 수의 합은 2이상입니다.

---

### 입출력 예

edges|result
---|---
[[2, 3], [4, 3], [1, 1], [2, 1]]|[2, 1, 1, 0]
[[4, 11], [1, 12], [8, 3], [12, 7], [4, 2], [7, 11], [4, 8], [9, 6], [10, 11], [6, 10], [3, 5], [11, 1], [5, 3], [11, 9], [3, 8]]|[4, 0, 1, 2]

---
### 입출력 예 설명

>입출력 예 #1

주어진 그래프를 그림으로 나타내면 다음과 같습니다.

![image](/assets/images/2024_kakao_winter_internship/Donuts_and_bar_graphs/image-3.png)

2번 정점이 생성한 정점이고 도넛 모양 그래프 1개, 막대 모양 그래프 1개가 존재합니다. 따라서 [2, 1, 1, 0]을 return 해야 합니다.

>입출력 예 #2

주어진 그래프를 그림으로 나타내면 다음과 같습니다.

![image](/assets/images/2024_kakao_winter_internship/Donuts_and_bar_graphs/image-4.png)
/Volumes/ExternalSSD/workspace/yousangson.github.io/assets/images/2024_kakao_winter_internship/Donuts_and_bar_graphs/image-1.png
4번 정점이 생성한 정점이고 막대 모양 그래프 1개, 8자 모양 그래프 2개가 존재합니다. 따라서 [4, 0, 1, 2]를 return 해야 합니다.

---

### 풀이
1. 들어오는 간선이 존재하지 않고, 나가는 간선이 2개 이상인 정점을 찾습니다. 이러한 정점은 하나만 존재하며, 해당 정점이 생성된 정점입니다.
2. 생성된 정점과 연결된 간선의 개수를 셉니다. 해당 간선들의 개수는 모양 그래프의 총개수와 동일합니다.
3. 들어오는 간선이 없는 정점의 개수 혹은 나가는 간선이 없는 정점의 개수를 셉니다. 해당 정점들은 각 막대 모양 그래프마다 하나씩만 존재하기 때문에 해당 정점들의 개수는 막대 모양 그래프의 개수와 동일합니다.
4. 들어오는 간선이 2개이상 이면서 나가는 간선이 2개인 정점의 개수를 셉니다. 해당 정점들은 각 8자 모양 그래프마다 하나씩만 존재하기 때문에, 해당 정점들의 개수는 8자 모양 그래프의 개수와 동일합니다.
5. 모양 그래프의 총 개수에서 4번과 5번에서 센 정점들의 개수를 뺍니다. 구한 값은 도넛 모양 그래프의 개수와 동일합니다.

---

#### golang
<details>
<summary>코드</summary>

```golang
func solution(edges [][]int) []int {

	inDegree := make(map[int]int)
	outDegree := make(map[int]int)

	for _, edge := range edges {
		outDegree[edge[0]]++
		inDegree[edge[1]]++
	}

	var generatedVertex int
	for vertex, outDeg := range outDegree {
		if inDegree[vertex] == 0 && outDeg >= 2 {
			generatedVertex = vertex
			break
		}
	}

	totalGraphs := outDegree[generatedVertex]

	barGraphs, figureEightGraphs, donutGraphs := 0, 0, 0
	for vertex, _ := range inDegree {
		if vertex != generatedVertex {
			if inDegree[vertex] == 0 || outDegree[vertex] == 0 {
				barGraphs++
			} else if inDegree[vertex] >= 2 && outDegree[vertex] == 2 {
				figureEightGraphs++
			}
		}
	}

	donutGraphs = totalGraphs - barGraphs - figureEightGraphs

	return []int{generatedVertex, donutGraphs, barGraphs, figureEightGraphs}
}
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.05ms, 4.23MB)
테스트 2 |	통과 (0.06ms, 3.56MB)
테스트 3 |	통과 (0.08ms, 4.15MB)
테스트 4 |	통과 (0.08ms, 4.16MB)
테스트 5 |	통과 (0.22ms, 3.56MB)
테스트 6 |	통과 (0.24ms, 3.56MB)
테스트 7 |	통과 (0.21ms, 4.22MB)
테스트 8 |	통과 (155.00ms, 73.7MB)
테스트 9 |	통과 (56.65ms, 44.3MB)
테스트 10 |	통과 (172.22ms, 98.5MB)
테스트 11 |	통과 (164.94ms, 83.9MB)
테스트 12 |	통과 (168.38ms, 84.1MB)
테스트 13 |	통과 (140.94ms, 74.8MB)
테스트 14 |	통과 (339.70ms, 163MB)
테스트 15 |	통과 (162.14ms, 83.1MB)
테스트 16 |	통과 (70.57ms, 50.2MB)
테스트 17 |	통과 (216.70ms, 96.1MB)
테스트 18 |	통과 (165.76ms, 73.7MB)
테스트 19 |	통과 (140.47ms, 83.6MB)
테스트 20 |	통과 (142.42ms, 79.4MB)
테스트 21 |	통과 (378.79ms, 157MB)
테스트 22 |	통과 (412.67ms, 141MB)
테스트 23 |	통과 (274.28ms, 140MB)
테스트 24 |	통과 (277.07ms, 141MB)
테스트 25 |	통과 (294.49ms, 140MB)
테스트 26 |	통과 (271.94ms, 141MB)

</details>

#### java
<details>
<summary>코드</summary>

```java
class Solution {
    public static int[] solution(int[][] edges) {
        Map<Integer, Integer> inDegree = new HashMap<>();
        Map<Integer, Integer> outDegree = new HashMap<>();

        for (int[] edge : edges) {
            outDegree.put(edge[0], outDegree.getOrDefault(edge[0], 0) + 1);
            inDegree.put(edge[1], inDegree.getOrDefault(edge[1], 0) + 1);
        }

        int generatedVertex = -1;
        for (Map.Entry<Integer, Integer> entry : outDegree.entrySet()) {
            if (!inDegree.containsKey(entry.getKey()) && entry.getValue() >= 2) {
                generatedVertex = entry.getKey();
                break;
            }
        }

        int totalGraphs = outDegree.getOrDefault(generatedVertex, 0);

        int barGraphs = 0, figureEightGraphs = 0, donutGraphs = 0;
        for (Map.Entry<Integer, Integer> entry : inDegree.entrySet()) {
            if (entry.getKey() != generatedVertex) {
                if (entry.getValue() == 0 || outDegree.getOrDefault(entry.getKey(), 0) == 0) {
                    barGraphs++;
                } else if (entry.getValue() >= 2 && outDegree.getOrDefault(entry.getKey(), 0) == 2) {
                    figureEightGraphs++;
                }
            }
        }

        donutGraphs = totalGraphs - barGraphs - figureEightGraphs;

        return new int[]{generatedVertex, donutGraphs, barGraphs, figureEightGraphs};
    }
}
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.56ms, 75.4MB)
테스트 2 |	통과 (0.54ms, 78.5MB)
테스트 3 |	통과 (0.78ms, 72MB)
테스트 4 |	통과 (0.43ms, 71MB)
테스트 5 |	통과 (1.56ms, 78.4MB)
테스트 6 |	통과 (1.42ms, 86.3MB)
테스트 7 |	통과 (1.56ms, 75.9MB)
테스트 8 |	통과 (366.00ms, 187MB)
테스트 9 |	통과 (152.46ms, 139MB)
테스트 10 |	통과 (272.11ms, 245MB)
테스트 11 |	통과 (276.54ms, 169MB)
테스트 12 |	통과 (268.86ms, 174MB)
테스트 13 |	통과 (291.00ms, 184MB)
테스트 14 |	통과 (489.04ms, 324MB)
테스트 15 |	통과 (291.18ms, 192MB)
테스트 16 |	통과 (137.83ms, 159MB)
테스트 17 |	통과 (384.21ms, 255MB)
테스트 18 |	통과 (305.53ms, 200MB)
테스트 19 |	통과 (246.48ms, 165MB)
테스트 20 |	통과 (218.90ms, 169MB)
테스트 21 |	통과 (436.50ms, 283MB)
테스트 22 |	통과 (321.54ms, 253MB)
테스트 23 |	통과 (299.83ms, 265MB)
테스트 24 |	통과 (312.91ms, 246MB)
테스트 25 |	통과 (268.44ms, 243MB)
테스트 26 |	통과 (249.98ms, 255MB)

</details>

#### kotlin
<details>
<summary>코드</summary>

```kotlin
class Solution {
    fun solution(edges: Array<IntArray>): IntArray {
        val inDegree = mutableMapOf<Int, Int>()
        val outDegree = mutableMapOf<Int, Int>()
    
        for (edge in edges) {
            outDegree[edge[0]] = outDegree.getOrDefault(edge[0], 0) + 1
            inDegree[edge[1]] = inDegree.getOrDefault(edge[1], 0) + 1
        }
    
        val generatedVertex = outDegree.entries.find { (k, v) -> k !in inDegree && v >= 2 }?.key ?: -1
        val totalGraphs = outDegree[generatedVertex] ?: 0
    
        var barGraphs = 0
        var figureEightGraphs = 0
        inDegree.forEach { (k, v) ->
            if (k != generatedVertex) {
                when {
                    v == 0 || outDegree.getOrDefault(k, 0) == 0 -> barGraphs++
                    v >= 2 && outDegree.getOrDefault(k, 0) == 2 -> figureEightGraphs++
                }
            }
        }
    
        val donutGraphs = totalGraphs - barGraphs - figureEightGraphs
    
        return intArrayOf(generatedVertex, donutGraphs, barGraphs, figureEightGraphs)
    }
}
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.75ms, 60.2MB)
테스트 2 |	통과 (0.98ms, 62.5MB)
테스트 3 |	통과 (0.96ms, 62.5MB)
테스트 4 |	통과 (0.74ms, 60.3MB)
테스트 5 |	통과 (2.00ms, 60.5MB)
테스트 6 |	통과 (1.53ms, 61.2MB)
테스트 7 |	통과 (2.62ms, 61.5MB)
테스트 8 |	통과 (359.83ms, 166MB)
테스트 9 |	통과 (116.31ms, 126MB)
테스트 10 |	통과 (483.84ms, 229MB)
테스트 11 |	통과 (282.97ms, 181MB)
테스트 12 |	통과 (230.12ms, 180MB)
테스트 13 |	통과 (218.59ms, 174MB)
테스트 14 |	통과 (408.06ms, 323MB)
테스트 15 |	통과 (272.15ms, 180MB)
테스트 16 |	통과 (198.63ms, 138MB)
테스트 17 |	통과 (443.50ms, 227MB)
테스트 18 |	통과 (329.26ms, 173MB)
테스트 19 |	통과 (324.41ms, 177MB)
테스트 20 |	통과 (306.51ms, 166MB)
테스트 21 |	통과 (511.39ms, 290MB)
테스트 22 |	통과 (378.72ms, 250MB)
테스트 23 |	통과 (426.14ms, 244MB)
테스트 24 |	통과 (369.42ms, 230MB)
테스트 25 |	통과 (453.42ms, 248MB)
테스트 26 |	통과 (431.72ms, 248MB)

</details>

#### python
<details>
<summary>코드</summary>

```python
def solution(edges):
    in_degree = {}
    out_degree = {}

    for a, b in edges:
        out_degree[a] = out_degree.get(a, 0) + 1
        in_degree[b] = in_degree.get(b, 0) + 1

    generated_vertex = 0
    for vertex in out_degree:
        if vertex not in in_degree and out_degree[vertex] >= 2:
            generated_vertex = vertex
            break

    total_graphs = out_degree.get(generated_vertex, 0)

    bar_graphs = figure_eight_graphs = donut_graphs = 0
    for vertex in in_degree:
        if vertex != generated_vertex:
            if in_degree[vertex] == 0 or out_degree.get(vertex, 0) == 0:
                bar_graphs += 1
            elif in_degree[vertex] >= 2 and out_degree.get(vertex, 0) == 2:
                figure_eight_graphs += 1

    donut_graphs = total_graphs - bar_graphs - figure_eight_graphs

    return [generated_vertex, donut_graphs, bar_graphs, figure_eight_graphs]
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |통과 (0.05ms, 10.2MB)
테스트 2 |통과 (0.08ms, 10.3MB)
테스트 3 |통과 (0.17ms, 10.2MB)
테스트 4 |통과 (0.05ms, 10.1MB)
테스트 5 |통과 (0.40ms, 10.3MB)
테스트 6 |통과 (0.27ms, 10.1MB)
테스트 7 |통과 (0.28ms, 10.2MB)
테스트 8 |통과 (323.66ms, 79MB)
테스트 9 |통과 (143.21ms, 53.2MB)
테스트 10 |통과 (487.18ms, 130MB)
테스트 11 |통과 (264.36ms, 82.5MB)
테스트 12 |통과 (292.39ms, 82.9MB)
테스트 13 |통과 (252.78ms, 83.6MB)
테스트 14 |통과 (600.28ms, 149MB)
테스트 15 |통과 (300.50ms, 82.1MB)
테스트 16 |통과 (201.80ms, 67.4MB)
테스트 17 |통과 (421.28ms, 127MB)
테스트 18 |통과 (261.88ms, 79.1MB)
테스트 19 |통과 (270.48ms, 82MB)
테스트 20 |통과 (225.08ms, 77.7MB)
테스트 21 |통과 (576.01ms, 142MB)
테스트 22 |통과 (430.25ms, 133MB)
테스트 23 |통과 (433.93ms, 133MB)
테스트 24 |통과 (481.22ms, 133MB)
테스트 25 |통과 (487.94ms, 133MB)
테스트 26 |통과 (480.97ms, 135MB)

</details>

#### javascript
<details>
<summary>코드</summary>

```javascript
function solution(edges) {
    let inDegree = {};
    let outDegree = {};

    for (let [from, to] of edges) {
        outDegree[from] = (outDegree[from] || 0) + 1;
        inDegree[to] = (inDegree[to] || 0) + 1;
    }

    let generatedVertex = 0;
    for (let vertex in outDegree) {
        if (!(vertex in inDegree) && outDegree[vertex] >= 2) {
            generatedVertex = vertex;
            break;
        }
    }

    let totalGraphs = outDegree[generatedVertex] || 0;

    let barGraphs = 0, figureEightGraphs = 0, donutGraphs = 0;
    for (let vertex in inDegree) {
        if (vertex != generatedVertex) {
            if (!inDegree[vertex] || !outDegree[vertex]) {
                barGraphs++;
            } else if (inDegree[vertex] >= 2 && outDegree[vertex] == 2) {
                figureEightGraphs++;
            }
        }
    }

    donutGraphs = totalGraphs - barGraphs - figureEightGraphs;

    return [parseInt(generatedVertex), donutGraphs, barGraphs, figureEightGraphs];
}
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.27ms, 33.2MB)
테스트 2 |	통과 (0.31ms, 33.5MB)
테스트 3 |	통과 (0.33ms, 33.5MB)
테스트 4 |	통과 (0.26ms, 33.3MB)
테스트 5 |	통과 (0.56ms, 33.8MB)
테스트 6 |	통과 (0.55ms, 33.9MB)
테스트 7 |	통과 (0.50ms, 32.5MB)
테스트 8 |	통과 (195.99ms, 148MB)
테스트 9 |	통과 (107.87ms, 104MB)
테스트 10 |	통과 (282.91ms, 185MB)
테스트 11 |	통과 (197.24ms, 141MB)
테스트 12 |	통과 (184.22ms, 149MB)
테스트 13 |	통과 (146.21ms, 136MB)
테스트 14 |	통과 (457.13ms, 250MB)
테스트 15 |	통과 (134.05ms, 140MB)
테스트 16 |	통과 (102.32ms, 113MB)
테스트 17 |	통과 (282.23ms, 185MB)
테스트 18 |	통과 (159.20ms, 146MB)
테스트 19 |	통과 (180.71ms, 152MB)
테스트 20 |	통과 (154.01ms, 136MB)
테스트 21 |	통과 (381.21ms, 243MB)
테스트 22 |	통과 (317.14ms, 200MB)
테스트 23 |	통과 (303.76ms, 203MB)
테스트 24 |	통과 (304.22ms, 204MB)
테스트 25 |	통과 (326.81ms, 204MB)
테스트 26 |	통과 (317.92ms, 200MB)

</details>