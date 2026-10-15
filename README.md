# 내 업무페이지 (초안)

일정, 사업공고, 할 일, 메모를 한 화면에서 보는 개인 업무 대시보드입니다.
서버 없이 동작합니다. 정적 페이지는 GitHub Pages가, 매일 공고 수집은 GitHub Actions가 맡습니다.

## 기능

| 탭 | 내용 |
|---|---|
| 대시보드 | 오늘 일정, 관심공고 마감 임박(D-7), 남은 할 일, 최근 3일 새 공고, 바로가기 링크 |
| 일정 | 월간 달력. 날짜를 눌러 일정 추가·수정·삭제(업무/회의/마감/개인). 관심공고 마감일도 달력에 표시 |
| 사업공고 | 매일 수집된 공고 목록. 검색, 출처·상태 필터, 마감 임박순 정렬, ★관심공고, "일정에 추가", 관심 키워드 태그, NEW 표시 |
| 할 일 · 메모 | 마감일이 있는 할 일 목록, 자동 저장 메모, 백업 내보내기/가져오기 |

## 구조

```
index.html / style.css / app.js   화면 (빌드 없음)
data/notices.json                 수집된 공고 (지금은 샘플 데이터)
crawler/crawl.py                  공고 수집기 (파이썬 표준 라이브러리만 사용)
crawler/config.json               관심 키워드, 제외 키워드, 수집처 설정
.github/workflows/crawl.yml       매일 07:00 KST에 수집하고 커밋
tests/                            수집기 단위 테스트
```

## 설정 방법

1. **API 키 발급 (무료)**
   - 기업마당: https://www.bizinfo.go.kr → 정책정보 개방(API) → 인증키 신청
   - K-Startup: https://www.data.go.kr 에서 "창업진흥원_K-Startup(사업소개,사업공고 등) 조회서비스" 활용신청
2. **GitHub Secrets 등록**: 저장소 Settings → Secrets and variables → Actions
   - `BIZINFO_API_KEY`
   - `DATA_GO_KR_KEY`
3. **수집 실행**: Actions 탭 → "사업공고 수집" → Run workflow. 이후 매일 자동으로 실행됩니다.
4. **페이지 공개**: Settings → Pages → Branch를 이 브랜치(또는 main)의 `/ (root)`로 지정
5. **관심 키워드 변경**: `crawler/config.json`의 `keywords`를 수정하면 해당 공고에 태그가 붙습니다.

키가 없으면 수집기는 해당 수집처를 건너뛰고 샘플 데이터를 그대로 둡니다.

## 로컬에서 보기

```bash
python3 -m http.server 8000
# http://localhost:8000
```

`index.html`을 더블클릭해서 열면 브라우저 보안 정책 때문에 공고 파일을 읽지 못합니다. 위처럼 서버로 여세요.

## 알아둘 점

- 일정, 할 일, 메모, 관심공고는 **이 브라우저의 localStorage에만** 저장됩니다. 다른 기기와 동기화하려면 백업 파일을 쓰거나, 다음 단계에서 구글 캘린더 연동 등을 붙여야 합니다.
- 저장소가 공개 상태이면 수집된 공고 목록도 공개됩니다. 개인 일정은 저장소에 올라가지 않습니다.

## 테스트

```bash
python3 -m unittest discover -s tests
```
