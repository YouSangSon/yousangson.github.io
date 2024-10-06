---
layout: post
title: 가장 많이 받은 선물
categories: [coding test, 2024 kakao winter internship]
tags: [coding test, 2024 kakao winter internship] # TAG names should always be lowercase
---

## 출처 [프로그래머스](https://school.programmers.co.kr/learn/courses/30/lessons/258712)

### 문제 설명
선물을 직접 전하기 힘들 때 카카오톡 선물하기 기능을 이용해 축하 선물을 보낼 수 있습니다. 

당신의 친구들이 이번 달까지 선물을 주고받은 기록을 바탕으로 다음 달에 누가 선물을 많이 받을지 예측하려고 합니다.

두 사람이 선물을 주고받은 기록이 있다면, 이번 달까지 두 사람 사이에 더 많은 선물을 준 사람이 다음 달에 선물을 하나 받습니다.

예를 들어 A가 B에게 선물을 5번 줬고, B가 A에게 선물을 3번 줬다면 다음 달엔 A가 B에게 선물을 하나 받습니다.

두 사람이 선물을 주고받은 기록이 하나도 없거나 주고받은 수가 같다면, 선물 지수가 더 큰 사람이 선물 지수가 더 작은 사람에게 선물을 하나 받습니다.

선물 지수는 이번 달까지 자신이 친구들에게 준 선물의 수에서 받은 선물의 수를 뺀 값입니다.

예를 들어 A가 친구들에게 준 선물이 3개고 받은 선물이 10개라면 A의 선물 지수는 -7입니다. 

B가 친구들에게 준 선물이 3개고 받은 선물이 2개라면 B의 선물 지수는 1입니다. 

만약 A와 B가 선물을 주고받은 적이 없거나 정확히 같은 수로 선물을 주고받았다면, 다음 달엔 B가 A에게 선물을 하나 받습니다.

만약 두 사람의 선물 지수도 같다면 다음 달에 선물을 주고받지 않습니다.

위에서 설명한 규칙대로 다음 달에 선물을 주고받을 때, 당신은 선물을 가장 많이 받을 친구가 받을 선물의 수를 알고 싶습니다.

친구들의 이름을 담은 1차원 문자열 배열 friends 이번 달까지 친구들이 주고받은 선물 기록을 담은 1차원 문자열 배열 gifts가 매개변수로 주어집니다. 

이때, 다음달에 가장 많은 선물을 받는 친구가 받을 선물의 수를 return 하도록 solution 함수를 완성해 주세요.

---
### 제한사항
* 2 ≤ friends의 길이 = 친구들의 수 ≤ 50
  
  * friends의 원소는 친구의 이름을 의미하는 알파벳 소문자로 이루어진 길이가 10 이하인 문자열입니다.
  
  * 이름이 같은 친구는 없습니다.
  
* 1 ≤ gifts의 길이 ≤ 10,000

  * gifts의 원소는 "A B"형태의 문자열입니다. A는 선물을 준 친구의 이름을 B는 선물을 받은 친구의 이름을 의미하며 공백 하나로 구분됩니다.
  
  * A와 B는 friends의 원소이며 A와 B가 같은 이름인 경우는 존재하지 않습니다.

---

### 입출력 예

|friends|gifts|result|
|---|---|---|
|["muzi", "ryan", "frodo", "neo"]|["muzi frodo", "muzi frodo", "ryan muzi", "ryan muzi", "ryan muzi", "frodo muzi", "frodo ryan", "neo muzi"]|2|
|["joy", "brad", "alessandro", "conan", "david"]|["alessandro brad", "alessandro joy", "alessandro conan", "david alessandro", "alessandro david"]|4|
|["a", "b", "c"]|["a b", "b a", "c a", "a c", "a c", "c a"]|0|

---
### 입출력 예 설명

>입출력 예 #1

주고받은 선물과 선물 지수를 표로 나타내면 다음과 같습니다.

↓준 사람 \ 받은 사람→|muzi|ryan|frodo|neo
---|---|---|---|---
muzi|-|0|2|0
ryan|3|-|0|0
frodo|1|1|-|0
neo|1|0|0|-

이름|준 선물|받은 선물|선물 지수
---|---|---|---
muzi|2|5|-3
ryan|3|1|2
frodo|2|2|0
neo|1|0|1|

muzi는 선물을 더 많이 줬던 frodo에게서 선물을 하나 받습니다.

ryan은 선물을 더 많이 줬던 muzi에게서 선물을 하나 받고, 선물을 주고받지 않았던 neo보다 선물 지수가 커 선물을 하나 받습니다.

frodo는 선물을 더 많이 줬던 ryan에게 선물을 하나 받습니다.

neo는 선물을 더 많이 줬던 muzi에게서 선물을 하나 받고, 선물을 주고받지 않았던 frodo보다 선물 지수가 커 선물을 하나 받습니다.

다음달에 가장 선물을 많이 받는 사람은 ryan과 neo이고 2개의 선물을 받습니다. 따라서 2를 return 해야 합니다.

>입출력 예 #2

주고받은 선물과 선물 지수를 표로 나타내면 다음과 같습니다.

↓준 사람 \ 받은 사람→	|joy	|brad	|alessandro	|conan	|david
---|---|---|---|---|---
joy	-	|0	|0	|0	|0
brad	|0	|-	|0	|0	|0
alessandro	|1	|1	|-	|1	|1
conan	|0	|0	|0	|-	|0
david	|0	|0	|1	|0	|-

이름	|준 선물	|받은 선물	|선물 지수
---|---|---|---
joy	|0	|1	|-1
brad	|0	|1	|-1
alessandro	|4	|1	|3
conan	|0	|1	|-1
david	|1	|1	|0

alessandro가 선물을 더 많이 줬던 joy, brad, conan에게서 선물을 3개 받습니다. 

선물을 하나씩 주고받은 david보다 선물 지수가 커 선물을 하나 받습니다.

david는 선물을 주고받지 않았던 joy, brad, conan보다 선물 지수가 커 다음 달에 선물을 3개 받습니다.

joy, brad, conan은 선물을 받지 못합니다.

다음달에 가장 선물을 많이 받는 사람은 alessandro이고 4개의 선물을 받습니다. 따라서 4를 return 해야 합니다.

>입출력 예 #3

a와 b, a와 c, b와 c 사이에 서로 선물을 주고받은 수도 같고 세 사람의 선물 지수도 0으로 같아 다음 달엔 아무도 선물을 받지 못합니다. 

따라서 0을 return 해야 합니다.

---

### 풀이

1. 선물 교환 기록 파싱: gifts 배열에서 각 선물 교환 기록을 분석하여 누가 누구에게 선물을 줬는지 계산합니다.
2. 선물 지수 계산: 각 친구의 선물 지수를 계산합니다. 선물 지수는 그 친구가 준 선물 수에서 받은 선물 수를 뺀 값입니다.
3. 다음 달 선물 받을 친구 예측: 규칙에 따라 다음 달 각 친구가 받을 선물 수를 예측합니다.
4. 가장 많은 선물을 받을 친구 찾기: 다음 달에 가장 많은 선물을 받을 친구를 찾고, 그 친구가 받을 선물 수를 반환합니다.

---

#### golang
<details>
<summary>코드</summary>

```golang
func solution(friends []string, gifts []string) int {

	totalMaps := make(map[string]map[string]int)
	sumMap := make(map[string]int)

	for _, friend := range friends {
		totalMaps[friend] = make(map[string]int)
		sumMap[friend] = 0
	}

	for friend, totalMap := range totalMaps {
		for _, friend2 := range friends {
			if friend != friend2 {
				totalMap[friend2] = 0
			}
		}
	}

	for _, gift := range gifts {
		giver := strings.Split(gift, " ")[0]
		receiver := strings.Split(gift, " ")[1]

		sumMap[giver]++
		sumMap[receiver]--

		totalMaps[giver][receiver]++
	}

	resultMap := make(map[string]int)

	for giver, totalMap := range totalMaps {
		for receiver, _ := range totalMap {
			if giver != receiver {
				_, ok := totalMaps[giver][receiver]
				_, ok2 := totalMaps[receiver][giver]

				if ok && ok2 {
					if totalMaps[giver][receiver] == totalMaps[receiver][giver] {
						if sumMap[giver] > sumMap[receiver] {
							resultMap[giver] += 1
						}
					}

					if totalMaps[giver][receiver] > totalMaps[receiver][giver] {
						resultMap[giver] += 1
					}
				} else {
					if sumMap[giver] > sumMap[receiver] {
						resultMap[giver] += 1
					}
				}
			}
		}
	}

	maxGifts := 0
	for _, gifts := range resultMap {
		if gifts > maxGifts {
			maxGifts = gifts
		}
	}

	return maxGifts
}
```

</details>

<details>
<summary>결과</summary>
 
정확성 | 테스트
---|---
테스트 1 |	통과 (0.03ms, 4.28MB)
테스트 2 |	통과 (0.02ms, 3.77MB)
테스트 3 |	통과 (0.10ms, 4.19MB)
테스트 4 |	통과 (0.10ms, 4.2MB)
테스트 5 |	통과 (1.12ms, 4.2MB)
테스트 6 |	통과 (0.27ms, 4.19MB)
테스트 7 |	통과 (0.77ms, 4.13MB)
테스트 8 |	통과 (0.96ms, 4.21MB)
테스트 9 |	통과 (3.22ms, 4.27MB)
테스트 10 |	통과 (3.83ms, 3.79MB)
테스트 11 |	통과 (2.91ms, 3.68MB)
테스트 12 |	통과 (2.65ms, 4.19MB)
테스트 13 |	통과 (7.79ms, 4.84MB)
테스트 14 |	통과 (4.14ms, 4.82MB)
테스트 15 |	통과 (5.09ms, 4.9MB)
테스트 16 |	통과 (7.98ms, 5.07MB)
테스트 17 |	통과 (0.09ms, 3.54MB)
테스트 18 |	통과 (1.93ms, 4.14MB)
테스트 19 |	통과 (7.56ms, 4.73MB)
테스트 20 |	통과 (3.73ms, 4.2MB)

</details>

#### java
<details>
<summary>코드</summary>

```java
class Solution {
    public int solution(String[] friends, String[] gifts) {
        Map<String, Map<String, Integer>> totalMaps = new HashMap<>();
        Map<String, Integer> sumMap = new HashMap<>();

        for (String friend : friends) {
            Map<String, Integer> friendMap = new HashMap<>();
            for (String otherFriend : friends) {
                if (!friend.equals(otherFriend)) {
                    friendMap.put(otherFriend, 0);
                }
            }
            totalMaps.put(friend, friendMap);
            sumMap.put(friend, 0);
        }

        for (String gift : gifts) {
            String[] parts = gift.split(" ");
            String giver = parts[0];
            String receiver = parts[1];

            sumMap.put(giver, sumMap.getOrDefault(giver, 0) + 1);
            sumMap.put(receiver, sumMap.getOrDefault(receiver, 0) - 1);

            Map<String, Integer> giverMap = totalMaps.get(giver);
            giverMap.put(receiver, giverMap.getOrDefault(receiver, 0) + 1);
        }

        Map<String, Integer> resultMap = new HashMap<>();

        for (String giver : totalMaps.keySet()) {
            for (String receiver : totalMaps.get(giver).keySet()) {
                if (!giver.equals(receiver)) {
                    int giverToReceiver = totalMaps.get(giver).getOrDefault(receiver, 0);
                    int receiverToGiver = totalMaps.get(receiver).getOrDefault(giver, 0);

                    if (giverToReceiver == receiverToGiver) {
                        if (sumMap.get(giver) > sumMap.get(receiver)) {
                            resultMap.put(giver, resultMap.getOrDefault(giver, 0) + 1);
                        }
                    } else if (giverToReceiver > receiverToGiver) {
                        resultMap.put(giver, resultMap.getOrDefault(giver, 0) + 1);
                    }
                }
            }
        }

        int maxGifts = 0;

        for (int giftsReceived : resultMap.values()) {
            if (giftsReceived > maxGifts) {
                maxGifts = giftsReceived;
            }
        }

        return maxGifts;
    }
}
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.34ms, 81MB)
테스트 2 |	통과 (0.32ms, 67.6MB)
테스트 3 |	통과 (0.77ms, 80.7MB)
테스트 4 |	통과 (0.42ms, 71.5MB)
테스트 5 |	통과 (4.32ms, 78.8MB)
테스트 6 |	통과 (1.05ms, 77.7MB)
테스트 7 |	통과 (3.42ms, 79.4MB)
테스트 8 |	통과 (3.67ms, 81.7MB)
테스트 9 |	통과 (7.69ms, 83.4MB)
테스트 10 |	통과 (11.78ms, 80.7MB)
테스트 11 |	통과 (11.40ms, 91.1MB)
테스트 12 |	통과 (9.69ms, 79.2MB)
테스트 13 |	통과 (15.55ms, 98.4MB)
테스트 14 |	통과 (20.22ms, 91.5MB)
테스트 15 |	통과 (23.50ms, 105MB)
테스트 16 |	통과 (15.93ms, 99.8MB)
테스트 17 |	통과 (0.56ms, 76.5MB)
테스트 18 |	통과 (10.32ms, 89.4MB)
테스트 19 |	통과 (17.82ms, 96.5MB)
테스트 20 |	통과 (8.05ms, 85.9MB)

</details>

#### kotlin
<details>
<summary>코드</summary>

```kotlin
class Solution {
    fun solution(friends: Array<String>, gifts: Array<String>): Int {
        val totalMaps =
                friends
                        .associateWith { friend ->
                            friends.filter { it != friend }.associateWith { 0 }.toMutableMap()
                        }
                        .toMutableMap()
        val sumMap = friends.associateWith { 0 }.toMutableMap()

        gifts.forEach { gift ->
            val (giver, receiver) = gift.split(" ")
            sumMap[giver] = sumMap.getValue(giver) + 1
            sumMap[receiver] = sumMap.getValue(receiver) - 1

            val giverMap = totalMaps.getValue(giver)
            giverMap[receiver] = giverMap.getValue(receiver) + 1
        }

        val resultMap = mutableMapOf<String, Int>()
        totalMaps.forEach { (giver, receiverMap) ->
            receiverMap.forEach { (receiver, giverToReceiver) ->
                val receiverToGiver = totalMaps.getValue(receiver).getValue(giver)
                when {
                    giverToReceiver == receiverToGiver &&
                            sumMap.getValue(giver) > sumMap.getValue(receiver) ->
                            resultMap[giver] = resultMap.getOrDefault(giver, 0) + 1
                    giverToReceiver > receiverToGiver ->
                            resultMap[giver] = resultMap.getOrDefault(giver, 0) + 1
                }
            }
        }

        return resultMap.values.maxOrNull() ?: 0
    }
}
```

</details>

<details>
<summary>코드</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (16.89ms, 61.9MB)
테스트 2 |	통과 (17.58ms, 63.1MB)
테스트 3 |	통과 (17.62ms, 62.5MB)
테스트 4 |	통과 (17.49ms, 62.3MB)
테스트 5 |	통과 (25.99ms, 66MB)
테스트 6 |	통과 (21.11ms, 62MB)
테스트 7 |	통과 (21.58ms, 65.5MB)
테스트 8 |	통과 (27.83ms, 64.7MB)
테스트 9 |	통과 (28.29ms, 71.6MB)
테스트 10 |	통과 (32.90ms, 70.9MB)
테스트 11 |	통과 (28.41ms, 70.8MB)
테스트 12 |	통과 (32.23ms, 69.3MB)
테스트 13 |	통과 (48.98ms, 80MB)
테스트 14 |	통과 (71.89ms, 77.7MB)
테스트 15 |	통과 (45.97ms, 81.9MB)
테스트 16 |	통과 (55.32ms, 80.6MB)
테스트 17 |	통과 (25.25ms, 61.8MB)
테스트 18 |	통과 (56.88ms, 69.4MB)
테스트 19 |	통과 (50.92ms, 83.3MB)
테스트 20 |	통과 (27.27ms, 66.6MB)

</details>

#### python
<details>
<summary>코드</summary>

```python
def solution(friends, gifts):
    total_maps = {friend: {other: 0 for other in friends if other != friend} for friend in friends}
    sum_map = {friend: 0 for friend in friends}

    for gift in gifts:
        giver, receiver = gift.split()
        sum_map[giver] += 1
        sum_map[receiver] -= 1
        total_maps[giver][receiver] += 1

    result_map = {}
    for giver in total_maps:
        for receiver in total_maps[giver]:
            giver_to_receiver = total_maps[giver][receiver]
            receiver_to_giver = total_maps[receiver].get(giver, 0)

            if giver_to_receiver == receiver_to_giver:
                if sum_map[giver] > sum_map[receiver]:
                    result_map[giver] = result_map.get(giver, 0) + 1
            elif giver_to_receiver > receiver_to_giver:
                result_map[giver] = result_map.get(giver, 0) + 1

    return max(result_map.values(), default=0)
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.05ms, 10.2MB)
테스트 2 |	통과 (0.07ms, 10.1MB)
테스트 3 |	통과 (0.08ms, 10.1MB)
테스트 4 |	통과 (0.07ms, 10MB)
테스트 5 |	통과 (0.84ms, 10.4MB)
테스트 6 |	통과 (0.29ms, 10.1MB)
테스트 7 |	통과 (0.66ms, 10.2MB)
테스트 8 |	통과 (1.06ms, 10.3MB)
테스트 9 |	통과 (3.19ms, 10.6MB)
테스트 10 |	통과 (2.91ms, 10.4MB)
테스트 11 |	통과 (2.65ms, 10.4MB)
테스트 12 |	통과 (2.07ms, 10.3MB)
테스트 13 |	통과 (8.77ms, 10.8MB)
테스트 14 |	통과 (5.25ms, 10.4MB)
테스트 15 |	통과 (8.61ms, 10.5MB)
테스트 16 |	통과 (8.34ms, 10.8MB)
테스트 17 |	통과 (0.08ms, 10.1MB)
테스트 18 |	통과 (2.55ms, 10.5MB)
테스트 19 |	통과 (8.64ms, 10.6MB)
테스트 20 |	통과 (1.97ms, 10.4MB)

</details>

#### javascript
<details>
<summary>코드</summary>

```javascript
function solution(friends, gifts) {
    const totalMaps = {};
    const sumMap = {};

    friends.forEach(friend => {
        totalMaps[friend] = {};
        sumMap[friend] = 0;
        friends.forEach(other => {
            if (other !== friend) {
                totalMaps[friend][other] = 0;
            }
        });
    });

    gifts.forEach(gift => {
        const [giver, receiver] = gift.split(" ");
        sumMap[giver]++;
        sumMap[receiver]--;
        totalMaps[giver][receiver]++;
    });

    const resultMap = {};
    for (let giver in totalMaps) {
        for (let receiver in totalMaps[giver]) {
            const giverToReceiver = totalMaps[giver][receiver];
            const receiverToGiver = totalMaps[receiver][giver] || 0;

            if (giverToReceiver === receiverToGiver) {
                if (sumMap[giver] > sumMap[receiver]) {
                    resultMap[giver] = (resultMap[giver] || 0) + 1;
                }
            } else if (giverToReceiver > receiverToGiver) {
                resultMap[giver] = (resultMap[giver] || 0) + 1;
            }
        }
    }

    return Math.max(...Object.values(resultMap), 0);
}
```

</details>

<details>
<summary>결과</summary>

정확성 | 테스트
---|---
테스트 1 |	통과 (0.31ms, 33.4MB)
테스트 2 |	통과 (0.35ms, 33.7MB)
테스트 3 |	통과 (0.54ms, 33.7MB)
테스트 4 |	통과 (0.60ms, 33.6MB)
테스트 5 |	통과 (2.25ms, 33.8MB)
테스트 6 |	통과 (1.29ms, 33.5MB)
테스트 7 |	통과 (1.77ms, 33.8MB)
테스트 8 |	통과 (2.66ms, 33.9MB)
테스트 9 |	통과 (5.22ms, 36.8MB)
테스트 10 |	통과 (6.27ms, 37.1MB)
테스트 11 |	통과 (5.50ms, 37.1MB)
테스트 12 |	통과 (5.08ms, 36.8MB)
테스트 13 |	통과 (11.15ms, 37.7MB)
테스트 14 |	통과 (8.17ms, 37.1MB)
테스트 15 |	통과 (8.73ms, 37.4MB)
테스트 16 |	통과 (10.37ms, 37.8MB)
테스트 17 |	통과 (0.78ms, 33.5MB)
테스트 18 |	통과 (6.41ms, 36.8MB)
테스트 19 |	통과 (9.05ms, 37.4MB)
테스트 20 |	통과 (4.20ms, 36.6MB)

</details>