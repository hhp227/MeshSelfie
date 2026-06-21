# MeshSelfie PRD v1.1

| 항목 | 내용 |
| --- | --- |
| 문서 버전 | v1.1 |
| 업데이트 범위 | AI Provider 추상화, 입력 이미지 정책, 이미지 품질 검증, 썸네일, 데이터 보관, 생성 파이프라인, Gallery, 관리자/비용 설계 보완 |
| 원칙 | 기존 기능은 유지하고 추가/수정 방식으로 확장한다. |

## 1. 서비스 개요

MeshSelfie는 사용자가 여러 각도의 얼굴 사진을 업로드하면 AI가 이미지를 분석해 실제 3D 스캔과 유사한 Photorealistic Human Mesh(GLB)를 생성하는 AI 3D Reconstruction 플랫폼이다. 사용자는 브라우저에서 생성된 실사형 3D 인물 모델을 회전, 확대, 축소해 확인하고 GLB 파일을 다운로드할 수 있다.

MVP의 핵심 목표는 완성도 높은 풀 기능 플랫폼이 아니라, "정면 필수 + 선택 각도 사진으로 더 정확한 3D 스캔 모델 생성"이라는 사용 가설과 사용자의 지불 또는 재방문 의사를 빠르게 검증하는 것이다. 따라서 초기 버전은 이메일 인증, 다각도 이미지 업로드, 비동기 생성, 결과 목록, 3D 뷰어, 다운로드에 집중한다.

### 제품 정의

| 구분 | 정의 |
| --- | --- |
| 핵심 결과물 | 원본 인물의 얼굴 구조, 비율, 피부/얼굴 텍스처를 가능한 한 유지한 실사형 3D Human Mesh |
| 파일 형식 | GLB |
| 사용 경험 | 정면 사진을 필수로 업로드하고, 측면 사진과 좌/우 중 하나의 45도 사진을 선택으로 추가해 3D 스캔에 가까운 결과물을 생성하고 웹에서 검수한 뒤 다운로드 |
| 주요 품질 기준 | 얼굴 윤곽, 눈/코/입 위치, 얼굴 비율, 피부 톤, 주요 텍스처가 원본 사진과 유사해야 함 |

MVP 품질 구현은 얼굴·귀·턱·목을 우선 고정밀 복원하고 머리카락은 저해상도 hair shell로 근사하는 Hybrid Head Reconstruction을 기본으로 한다. 범용 image-to-3D 결과는 fallback 및 비교 대상으로만 사용한다.

### 비목표

| 항목 | 설명 |
| --- | --- |
| 캐릭터형 아바타 | 본 서비스는 게임 캐릭터, 만화풍 캐릭터, 스타일라이즈드 아바타 생성 서비스가 아니다. |
| VRM 캐릭터 | MVP 결과물은 VRM, 리깅된 캐릭터, 애니메이션용 캐릭터가 아니다. |
| Zepeto/Ready Player Me 스타일 | Zepeto, Ready Player Me처럼 캐릭터 커스터마이징 중심의 아바타 서비스가 아니다. |
| 창작형 변형 | 원본 인물과 다른 외모, 판타지 스타일, 의상/종족 변형은 MVP 범위가 아니다. |
| 미화 중심 보정 | 얼굴 구조를 임의로 바꾸는 뷰티 필터형 보정은 목표가 아니다. |

### 대상 사용자

| 구분 | 설명 |
| --- | --- |
| 3D 스캔 대체 수요 사용자 | 별도 스캐너 없이 자신의 얼굴 기반 실사형 3D 모델이 필요한 사용자 |
| 크리에이터 | 콘텐츠, 프로필, 영상 제작용 실사형 3D 인물 메시가 필요한 사용자 |
| 3D 제작 입문자 | 복잡한 3D 도구 없이 얼굴 기반 GLB 모델 파일을 얻고 싶은 사용자 |

### MVP 성공 지표

| 지표 | 목표 |
| --- | --- |
| 가입 후 첫 업로드 전환율 | 40% 이상 |
| 업로드 후 생성 요청 전환율 | 80% 이상 |
| 생성 완료율 | 90% 이상 |
| 생성 완료 후 다운로드율 | 30% 이상 |
| 평균 생성 실패율 | 10% 이하 |

## 2. 기능 요구사항

### 2.1 인증

| 기능 | 요구사항 |
| --- | --- |
| 이메일 회원가입 | Supabase Auth 이메일/비밀번호 기반 회원가입을 제공한다. |
| 이메일 로그인 | 등록된 이메일/비밀번호로 로그인한다. |
| 로그아웃 | 현재 세션을 종료하고 공개 랜딩 페이지로 이동한다. |
| 세션 유지 | 브라우저 새로고침 후에도 Supabase 세션을 유지한다. |
| 보호 라우트 | Dashboard, Upload, Result, Profile은 로그인 사용자만 접근 가능하다. |
| 관리자 보호 라우트 | Admin Dashboard와 관리자 API는 `admin` 권한 사용자만 접근 가능하다. |

### 2.2 사용자

| 기능 | 요구사항 |
| --- | --- |
| 내 프로필 조회 | 이메일, 가입일, 생성한 3D 모델 수, 최근 생성 상태를 표시한다. |
| 프로필 자동 생성 | Supabase Auth 가입 시 앱 `profiles` 레코드를 생성한다. |

### 2.3 이미지 업로드

| 항목 | 정책 |
| --- | --- |
| 지원 포맷 | JPG, JPEG, PNG |
| 최대 파일 크기 | 사진 1장당 MVP 기준 10MB |
| 이미지 해상도 | 권장 최소 512x512, 최대 4096x4096 |
| 업로드 개수 | 생성 요청 1건당 최소 1장, 최대 3장 |
| 필수 사진 | 정면 사진 1장 |
| 선택 사진 | 측면 사진 1장, 좌측 또는 우측 45도 사진 1장 |
| 향후 확장 사진 | 좌우 45도 동시 업로드, 좌측면/우측면 분리 업로드 |
| 검증 | MIME type, 확장자, 파일 크기, 이미지 디코딩 가능 여부를 검증한다. |
| 보관 | 원본 이미지는 Supabase Storage의 비공개 버킷에 저장한다. |

업로드 UX는 사진 슬롯별 드래그 앤 드롭과 파일 선택 버튼을 모두 지원한다. 정면 사진이 업로드되어야 생성 요청 버튼이 활성화된다.

사진 슬롯:

| 슬롯 | 필수 여부 | 허용 개수 | 설명 |
| --- | --- | --- | --- |
| `front` | 필수 | 1장 | 얼굴이 정면을 바라보는 사진 |
| `side` | 선택 | 1장 | 왼쪽 또는 오른쪽 측면 사진 |
| `angle45` | 선택 | 1장 | 좌측 45도 또는 우측 45도 사진 |

지원 입력 조합:

| Case | 입력 |
| --- | --- |
| Case 1 | `front_image` |
| Case 2 | `front_image` + `side_image` |
| Case 3 | `front_image` + `angle45_image` |
| Case 4 | `front_image` + `side_image` + `angle45_image` |

품질 등급:

| 입력 조합 | 예상 품질 등급 | 설명 |
| --- | --- | --- |
| `front` | B | 정면 얼굴 구조 중심으로 생성하며 측면/후면 형상은 추정 비중이 높다. |
| `front` + `side` | A | 측면 형상 정보가 추가되어 얼굴 깊이, 코/턱선, 머리 측면 구조 보존이 개선된다. |
| `front` + `angle45` | A | 중간 각도 정보가 추가되어 얼굴 깊이와 비율 추정이 개선된다. |
| `front` + `side` + `angle45` | A+ | 정면, 측면, 중간 각도 정보가 함께 반영되어 얼굴 및 머리 형상 보존 정확도가 가장 높다. |

좌/우 45도 정책:

| 항목 | 정책 |
| --- | --- |
| MVP 입력 | `angle45` 슬롯은 좌측 45도 또는 우측 45도 중 하나만 받는다. |
| 방향 저장 | 업로드 시 `angle45_direction = left | right`를 저장한다. |
| 비대칭성 | 사람 얼굴과 머리는 완전 대칭이 아니므로 좌측 45도와 우측 45도는 동일한 정보가 아니다. |
| MVP 판단 | 다만 사용자의 업로드 부담과 입력 슬롯 단순화를 위해 MVP에서는 45도 사진 1장만 선택 입력으로 둔다. |
| 향후 확장 | 품질 개선 단계에서 `left45`와 `right45`를 별도 슬롯으로 확장할 수 있다. |

### 2.4 이미지 품질 검증

업로드 직후 자동 검증을 수행한다. 검증은 사용자 경험을 막는 hard fail과 품질 개선을 권장하는 warning으로 나눈다.

| 검증 항목 | 정책 | 실패/경고 메시지 예시 |
| --- | --- | --- |
| 얼굴 존재 여부 | 얼굴이 감지되지 않으면 실패 | `얼굴이 인식되지 않았습니다. 얼굴이 잘 보이는 사진을 업로드해주세요.` |
| 얼굴 크기 | 얼굴 영역이 이미지의 최소 기준보다 작으면 실패 또는 경고 | `얼굴이 너무 작게 인식되었습니다.` |
| 다중 인물 여부 | 여러 얼굴이 감지되면 실패 | `한 명의 얼굴만 포함된 사진을 업로드해주세요.` |
| 흐림 여부 | blur score가 기준 미달이면 경고 또는 실패 | `사진이 흐릿합니다. 더 선명한 사진을 업로드해주세요.` |
| 얼굴 가림 여부 | 눈/코/입 주요 부위가 가려지면 실패 또는 경고 | `얼굴 일부가 가려져 있습니다. 다시 업로드해주세요.` |
| 선글라스 여부 | 눈 영역이 가려지면 경고 또는 실패 | `선글라스가 얼굴 구조 인식을 방해할 수 있습니다.` |
| 마스크 여부 | 코/입 영역이 가려지면 실패 | `마스크를 착용하지 않은 사진을 업로드해주세요.` |

검증 결과는 `source_images.validation_status`, `source_images.validation_errors`, `source_images.validation_warnings`에 저장한다.

### 2.5 AI 3D 생성

| 기능 | 요구사항 |
| --- | --- |
| 생성 요청 | 업로드된 정면/측면/45도 사진 중 존재하는 사진만 AI Provider 입력으로 전달해 실사형 Human Mesh 생성을 요청한다. |
| 비동기 처리 | Provider job ID를 저장하고 클라이언트는 상태 조회 API를 폴링한다. |
| 상태 저장 | `queued`, `validating`, `preprocessing`, `generating`, `postprocessing`, `thumbnailing`, `completed`, `failed`, `canceled` 상태를 저장한다. |
| 결과 저장 | 완료된 GLB 파일을 Supabase Storage 모델 버킷에 저장한다. |
| 실사성 유지 | 원본 인물의 얼굴 구조, 비율, 텍스처를 최대한 유지하는 모델과 프롬프트/파라미터를 사용한다. |
| 스타일 제한 | 게임 캐릭터, VRM, 만화풍, 판타지, 과도한 미화 스타일은 생성 옵션에서 제외한다. |
| 실패 처리 | 실패 사유, provider 에러 코드, 재시도 가능 여부를 저장한다. |
| 중복 방지 | 동일 사용자의 같은 사진 조합에 대해 진행 중인 생성 요청이 있으면 새 요청을 차단한다. |
| 생성 방식 | 결과 모델의 `model_source`는 AI 생성 시 `ai_generated`로 저장한다. |

### 2.6 생성 품질 요구사항

| 항목 | 요구사항 |
| --- | --- |
| 얼굴 구조 | 얼굴형, 턱선, 광대, 이마 비율이 원본 사진과 유사해야 한다. |
| 주요 부위 위치 | 눈, 코, 입, 귀의 상대적 위치와 크기 비율을 가능한 한 유지해야 한다. |
| 텍스처 | 피부 톤, 얼굴 표면 질감, 눈썹/수염/점 등 식별 가능한 특징을 가능한 범위에서 반영해야 한다. |
| 실사 렌더링 | 결과물은 스타일라이즈드 캐릭터가 아니라 실제 촬영/스캔 기반 모델에 가까운 질감을 가져야 한다. |
| 입력 사진 수 안내 | 정면 1장만으로도 생성 가능하지만, 측면과 45도 사진을 추가하면 얼굴 및 머리 형상 보존 정확도를 높일 수 있음을 안내한다. |
| 금지 방향 | 카툰화, 애니메이션화, 게임 캐릭터화, VRM 캐릭터화, 과장된 미화는 품질 목표가 아니다. |

### 2.7 결과 조회

| 기능 | 요구사항 |
| --- | --- |
| 모델 목록 | 생성일, 상태, 사용된 이미지 수, 품질 등급, 생성 방식, 썸네일, 모델 다운로드 버튼을 표시한다. |
| 상세 조회 | 단일 실사형 3D 모델의 입력 이미지, 생성 상태, 3D 뷰어, 다운로드 링크를 표시한다. |
| 다운로드 | 완료 상태에서만 GLB 다운로드를 허용한다. |
| 상태 갱신 | 처리 중인 작업은 3~5초 간격으로 상태를 갱신한다. |

### 2.8 관리자 모델 업로드

관리자는 AI 생성 흐름과 별개로 직접 생성된 3D 모델을 업로드하고 기존 사용자 모델을 교체할 수 있다.

| 기능 | 요구사항 |
| --- | --- |
| 직접 업로드 | 관리자는 GLB 또는 GLTF 파일을 업로드할 수 있다. |
| 향후 포맷 | FBX, OBJ는 향후 확장 후보로 둔다. |
| 모델 교체 | 관리자는 특정 사용자의 생성 실패 또는 품질 낮은 모델을 업로드 모델로 교체할 수 있다. |
| 모델 삭제 | 관리자는 부적절하거나 잘못 등록된 모델을 삭제할 수 있다. |
| 샘플 등록 | 관리자는 랜딩/테스트용 샘플 모델을 등록할 수 있다. |
| Featured Mesh 지정 | 관리자는 Gallery에 노출할 Featured Mesh를 지정할 수 있다. |
| 생성 방식 기록 | 관리자 업로드 모델의 `model_source`는 `admin_uploaded`로 저장한다. |

관리자 업로드 목적:

| 목적 | 설명 |
| --- | --- |
| AI 생성 실패 대응 | 실패한 생성 건에 대해 외부 제작 모델을 등록한다. |
| 외부 툴 결과 등록 | 외부 3D 툴 또는 파이프라인에서 생성한 모델을 서비스에 연결한다. |
| 테스트 데이터 구축 | 개발/QA용 모델 데이터를 구축한다. |
| 샘플 모델 제공 | 랜딩 또는 데모용 실사형 샘플 모델을 제공한다. |
| 품질 개선 모델 교체 | AI 생성 결과보다 개선된 모델로 교체한다. |

### 2.9 3D 뷰어

| 기능 | 요구사항 |
| --- | --- |
| GLB 렌더링 | 브라우저에서 GLB 모델을 표시한다. |
| 회전 | 마우스 드래그와 터치 드래그로 모델을 회전한다. |
| 확대/축소 | 휠, 핀치, 뷰어 컨트롤로 확대/축소한다. |
| 기본 조명 | 얼굴 구조와 텍스처 확인이 가능한 환경광/방향광을 제공한다. |
| 로딩 상태 | 모델 로딩 중 스켈레톤 또는 프로그레스를 표시한다. |
| 에러 상태 | 모델 로딩 실패 시 재시도와 다운로드 대체 액션을 제공한다. |

### 2.10 썸네일과 Preview Render

| 기능 | 요구사항 |
| --- | --- |
| Preview Render 생성 | 생성 완료 후 GLB 모델을 기준으로 대표 렌더 이미지를 생성한다. |
| Thumbnail 생성 | Dashboard, Gallery, 관리자 페이지에서 사용할 썸네일을 생성한다. |
| 저장 | 썸네일은 Storage `thumbnails/{user_id}/{human_mesh_id}/thumbnail.jpg`에 저장한다. |
| 메타데이터 | `thumbnail_url`, `thumbnail_generated_at`을 DB에 저장한다. |

### 2.11 Gallery

Landing Page에 Gallery 섹션을 추가해 서비스 품질을 홍보하고 사용자 예시를 제공한다. 관리자는 특정 Human Mesh를 Featured Mesh로 지정할 수 있다.

## 3. 비기능 요구사항

### 성능

| 항목 | 기준 |
| --- | --- |
| Landing Page LCP | 2.5초 이하 목표 |
| Dashboard 초기 로딩 | 3초 이하 목표 |
| 이미지 업로드 응답 | 업로드 API 응답 3초 이하 목표, 대용량 파일 전송 시간은 네트워크 상태에 따라 별도 측정 |
| 생성 시작 | 생성 요청 후 AI Provider job 생성까지 10초 이하 목표 |
| 목표 생성 시간 | 일반 작업 기준 2~5분 |
| 상태 조회 API | p95 500ms 이하 목표 |
| 3D 뷰어 로딩 | GLB 30MB 이하에서 5초 이하 목표 |
| 가용성 | 월간 99.5% 목표 |

### 신뢰성

| 항목 | 기준 |
| --- | --- |
| 생성 작업 추적 | 모든 Provider job ID와 상태 변경 시간을 저장한다. |
| 장애 복구 | 웹훅 실패에 대비해 상태 동기화 API 또는 cron 작업을 둔다. |
| 파일 정합성 | DB 레코드와 Storage 파일 경로를 함께 관리한다. |
| 실패 관측성 | API 에러, AI Provider 에러, Storage 에러를 구분해 기록한다. |
| Provider Failover | 기본 Provider 실패 시 fallback Provider로 재시도할 수 있도록 job과 provider 상태를 분리한다. |

### 보안

| 항목 | 기준 |
| --- | --- |
| 인증 | Supabase Auth를 사용한다. |
| 권한 | RLS로 사용자별 데이터 접근을 제한한다. |
| 파일 접근 | 원본 이미지와 모델 파일은 private bucket에 저장하고 signed URL로만 접근한다. |
| API 보호 | 모든 사용자 API는 세션 검증 후 실행한다. |
| 입력 검증 | 파일, JSON body, path parameter를 서버에서 검증한다. |
| 비밀키 | AI Provider token, Supabase service role key는 서버 환경 변수에만 저장한다. |

### 운영

| 항목 | 기준 |
| --- | --- |
| 배포 | Vercel |
| DB/Storage | Supabase |
| 로그 | Vercel 로그와 Supabase 로그를 사용한다. |
| 환경 분리 | local, preview, production 환경 변수를 분리한다. |
| 비용 제어 | 사용자별 일일 생성 제한과 전체 동시 처리 제한을 둔다. |
| 비용 추적 | generation job 단위로 예상 비용, 사용 크레딧, provider 비용 메타데이터를 저장한다. |

## 4. 데이터베이스 설계

Supabase Auth의 `auth.users`를 인증 원본으로 사용하고, 서비스 도메인 데이터는 `public` schema에 둔다. 모든 사용자 소유 테이블은 `user_id`로 `auth.users.id`를 참조하며 RLS를 적용한다.

요구사항의 `avatars` 테이블 개념은 본 PRD에서 실사형 3D 스캔 모델 의미를 명확히 하기 위해 `human_meshes` 테이블로 명명한다. v1.1 입력 정책에 따라 정면/측면/45도 이미지 경로와 `model_source`는 `human_meshes`에 반영한다.

### 4.1 profiles

사용자의 앱 프로필과 사용량 집계를 관리한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | `auth.users.id`와 동일한 PK |
| email | text | Y | 가입 이메일 |
| display_name | text | N | 표시 이름 |
| role | text | Y | `user` 또는 `admin`, 기본 `user` |
| mesh_quota_daily | integer | Y | 일일 Human Mesh 생성 가능 횟수, 기본 3 |
| remaining_credits | integer | Y | 남은 생성 크레딧, 결제 기능 전까지 운영자가 부여 |
| used_credits | integer | Y | 누적 사용 크레딧 |
| created_at | timestamptz | Y | 생성일 |
| updated_at | timestamptz | Y | 수정일 |
| last_login_at | timestamptz | N | 최근 로그인 일시 |

### 4.2 source_images

업로드된 원본 이미지 메타데이터를 저장한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | 이미지 ID |
| user_id | uuid | Y | 소유 사용자 ID |
| bucket | text | Y | Storage bucket 이름 |
| object_path | text | Y | Storage object path |
| image_role | text | Y | `front`, `side`, `angle45` |
| image_direction | text | N | `side` 또는 `angle45`의 방향, `left` 또는 `right` |
| original_filename | text | Y | 원본 파일명 |
| content_type | text | Y | `image/jpeg` 또는 `image/png` |
| file_size_bytes | bigint | Y | 파일 크기 |
| width | integer | N | 이미지 너비 |
| height | integer | N | 이미지 높이 |
| checksum_sha256 | text | N | 중복 탐지용 체크섬 |
| validation_status | text | Y | `pending`, `passed`, `warning`, `failed` |
| validation_errors | jsonb | N | 얼굴 없음, 다중 인물, 마스크 등 실패 사유 |
| validation_warnings | jsonb | N | 흐림, 얼굴 크기 경고 등 |
| face_bbox | jsonb | N | 감지된 얼굴 bounding box |
| blur_score | numeric | N | 흐림 점수 |
| status | text | Y | `uploaded`, `linked`, `deleted` |
| soft_deleted_at | timestamptz | N | 사용자 삭제 요청 시각 |
| purge_after | timestamptz | N | 영구 삭제 예정 시각 |
| created_at | timestamptz | Y | 생성일 |

### 4.3 human_meshes

사용자가 확인하고 다운로드할 최종 실사형 3D Human Mesh 단위를 저장한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | 모델 ID |
| user_id | uuid | Y | 소유 사용자 ID |
| front_source_image_id | uuid | Y | 정면 입력 이미지 ID |
| side_source_image_id | uuid | N | 측면 입력 이미지 ID |
| angle45_source_image_id | uuid | N | 45도 입력 이미지 ID |
| front_image_url | text | Y | 정면 이미지 Storage path 또는 signed URL 생성 기준 path |
| side_image_url | text | N | 측면 이미지 Storage path 또는 signed URL 생성 기준 path |
| side_direction | text | N | 측면 방향, `left` 또는 `right` |
| angle45_image_url | text | N | 45도 이미지 Storage path 또는 signed URL 생성 기준 path |
| angle45_direction | text | N | 45도 방향, `left` 또는 `right` |
| latest_job_id | uuid | N | 최신 생성 작업 ID |
| title | text | N | 사용자 표시명, 기본 `Scan YYYY-MM-DD` |
| status | text | Y | `queued`, `validating`, `preprocessing`, `generating`, `postprocessing`, `thumbnailing`, `completed`, `failed`, `canceled`, `deleted` |
| input_image_count | integer | Y | 생성에 사용된 사진 수, 1~3 |
| quality_grade | text | Y | `B`, `A`, `A+` |
| model_source | text | Y | `ai_generated` 또는 `admin_uploaded` |
| model_bucket | text | N | 모델 Storage bucket |
| model_object_path | text | N | GLB object path |
| model_content_type | text | N | `model/gltf-binary`, `model/gltf+json` 등 |
| model_file_size_bytes | bigint | N | GLB 크기 |
| quality_notes | jsonb | N | 얼굴 유사도, 텍스처 품질, 생성 한계 등 품질 메타데이터 |
| thumbnail_bucket | text | N | 썸네일 bucket |
| thumbnail_object_path | text | N | 썸네일 object path |
| thumbnail_url | text | N | 썸네일 Storage path 또는 signed URL 생성 기준 path |
| thumbnail_generated_at | timestamptz | N | 썸네일 생성 완료 시각 |
| preview_render_object_path | text | N | Preview Render 이미지 path |
| is_featured | boolean | Y | Gallery 노출 여부, 기본 false |
| featured_at | timestamptz | N | Featured Mesh 지정 시각 |
| completed_at | timestamptz | N | 완료일 |
| failed_at | timestamptz | N | 실패일 |
| soft_deleted_at | timestamptz | N | 삭제 요청 시각 |
| purge_after | timestamptz | N | 영구 삭제 예정 시각 |
| created_at | timestamptz | Y | 생성일 |
| updated_at | timestamptz | Y | 수정일 |

권장 인덱스:

| 인덱스 | 목적 |
| --- | --- |
| `human_meshes_user_created_idx` on `(user_id, created_at desc)` | Dashboard 목록 조회 |
| `human_meshes_user_status_idx` on `(user_id, status)` | 진행 중 작업 조회 |
| `human_meshes_source_idx` on `(model_source, created_at desc)` | 관리자 업로드/AI 생성 구분 조회 |

### 4.4 generation_jobs

AI Provider 실행 단위와 상태 변경 정보를 저장한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | 작업 ID |
| user_id | uuid | Y | 요청 사용자 ID |
| human_mesh_id | uuid | Y | 대상 실사형 3D 모델 ID |
| front_source_image_id | uuid | Y | 정면 입력 이미지 ID |
| side_source_image_id | uuid | N | 측면 입력 이미지 ID |
| angle45_source_image_id | uuid | N | 45도 입력 이미지 ID |
| provider | text | Y | `replicate`, `trellis`, `hunyuan3d`, `triposr`, `self_hosted` |
| provider_version_id | uuid | N | 사용한 provider/model version ID |
| model_name | text | Y | Provider별 모델명 |
| generation_mode | text | Y | `photorealistic_human_mesh` |
| provider_prediction_id | text | N | Provider job 또는 prediction ID |
| status | text | Y | `queued`, `validating`, `preprocessing`, `generating`, `postprocessing`, `thumbnailing`, `completed`, `failed`, `canceled` |
| progress | integer | N | 0~100, provider가 제공하지 않으면 null |
| quality_grade | text | Y | 입력 이미지 수 기준 예상 품질 등급 |
| estimated_generation_cost | numeric | N | 예상 provider 비용 |
| used_credits | integer | Y | 작업에 차감된 크레딧 |
| failover_from_job_id | uuid | N | Failover로 생성된 경우 원본 job ID |
| attempt_no | integer | Y | Provider 재시도 차수 |
| input_payload | jsonb | N | provider 요청 입력값의 민감정보 제외 버전 |
| output_payload | jsonb | N | provider 응답 출력 메타데이터 |
| error_code | text | N | 실패 코드 |
| error_message | text | N | 사용자 노출 가능한 실패 메시지 |
| internal_error | text | N | 운영자 디버깅용 메시지 |
| started_at | timestamptz | N | 시작일 |
| completed_at | timestamptz | N | 완료일 |
| failed_at | timestamptz | N | 실패일 |
| created_at | timestamptz | Y | 생성일 |
| updated_at | timestamptz | Y | 수정일 |

권장 인덱스:

| 인덱스 | 목적 |
| --- | --- |
| `generation_jobs_user_created_idx` on `(user_id, created_at desc)` | 사용자 작업 목록 |
| `generation_jobs_prediction_idx` on `(provider, provider_prediction_id)` | 웹훅 처리 |
| `generation_jobs_status_created_idx` on `(status, created_at)` | 상태 동기화 배치 |

### 4.5 ai_provider_versions

AI Provider와 모델 버전을 비즈니스 로직에서 분리해 관리한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | Provider version ID |
| provider_key | text | Y | `replicate`, `trellis`, `hunyuan3d`, `triposr`, `self_hosted` |
| model_name | text | Y | Provider 모델명 |
| model_version | text | Y | 모델 버전 또는 API version |
| is_active | boolean | Y | 사용 가능 여부 |
| priority | integer | Y | Provider 선택 우선순위 |
| supports_multi_view | boolean | Y | 다각도 입력 지원 여부 |
| max_input_images | integer | Y | 최대 입력 이미지 수 |
| estimated_cost_per_job | numeric | N | 예상 job 비용 |
| success_rate_rolling | numeric | N | 최근 성공률 |
| config | jsonb | N | Provider별 설정 |
| created_at | timestamptz | Y | 생성일 |
| updated_at | timestamptz | Y | 수정일 |

### 4.6 admin_model_uploads

관리자 직접 업로드, 모델 교체, 삭제 이력을 감사 가능하게 저장한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | 관리자 업로드 이력 ID |
| admin_user_id | uuid | Y | 작업한 관리자 ID |
| target_user_id | uuid | N | 모델 소유 사용자 ID |
| human_mesh_id | uuid | N | 연결 또는 교체 대상 모델 ID |
| action | text | Y | `upload`, `replace`, `delete`, `sample_create` |
| model_bucket | text | N | 업로드 모델 bucket |
| model_object_path | text | N | 업로드 모델 path |
| original_filename | text | N | 원본 파일명 |
| content_type | text | N | GLB/GLTF MIME type |
| file_size_bytes | bigint | N | 파일 크기 |
| reason | text | N | 작업 사유 |
| created_at | timestamptz | Y | 생성일 |

### 4.7 credit_ledger

향후 결제 기능을 위해 크레딧 증감 이력을 저장한다. 실제 결제 기능은 MVP 범위가 아니며, 운영자가 수동 부여하거나 프로모션 크레딧으로 관리한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | 크레딧 이력 ID |
| user_id | uuid | Y | 사용자 ID |
| generation_job_id | uuid | N | 관련 생성 작업 ID |
| delta | integer | Y | 증가/차감 크레딧 |
| balance_after | integer | Y | 반영 후 잔액 |
| reason | text | Y | `signup_bonus`, `generation_used`, `admin_adjustment`, `refund` |
| metadata | jsonb | N | 비용/Provider 부가 정보 |
| created_at | timestamptz | Y | 생성일 |

### 4.8 usage_events

MVP에서도 비용 추적을 위해 최소 사용량 이벤트를 저장한다.

| 컬럼 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| id | uuid | Y | 이벤트 ID |
| user_id | uuid | Y | 사용자 ID |
| event_type | text | Y | `image_uploaded`, `generation_requested`, `generation_completed`, `generation_failed`, `model_downloaded`, `admin_model_uploaded`, `admin_model_replaced`, `admin_model_deleted` |
| entity_type | text | N | `source_image`, `human_mesh`, `generation_job` |
| entity_id | uuid | N | 관련 엔티티 ID |
| metadata | jsonb | N | 부가 정보 |
| created_at | timestamptz | Y | 생성일 |

### 4.9 RLS 정책

| 테이블 | 정책 |
| --- | --- |
| profiles | 사용자는 자신의 profile만 select/update 가능하다. insert는 가입 트리거 또는 service role만 수행한다. |
| source_images | 사용자는 자신의 이미지 메타데이터만 select/insert 가능하다. delete는 MVP에서 soft delete만 허용한다. |
| human_meshes | 사용자는 자신의 실사형 3D 모델만 select/update 가능하다. status/model path 변경은 서버 API 또는 service role만 수행한다. |
| generation_jobs | 사용자는 자신의 작업만 select 가능하다. insert/status update는 서버 API 또는 service role만 수행한다. |
| ai_provider_versions | 일반 사용자는 접근할 수 없다. 서버 API와 관리자만 조회/수정한다. |
| admin_model_uploads | 일반 사용자는 접근할 수 없다. 관리자는 전체 select/insert 가능하며 삭제는 감사 추적을 위해 금지한다. |
| credit_ledger | 사용자는 자신의 크레딧 이력만 select 가능하다. insert/update는 서버 API 또는 관리자만 수행한다. |
| usage_events | 사용자는 자신의 이벤트 조회만 가능하다. insert는 서버 API 또는 service role만 수행한다. |

## 5. Storage 설계

Supabase Storage는 private bucket 중심으로 운영한다. 클라이언트가 직접 public URL을 알 수 없도록 하고, 서버가 사용자 권한을 확인한 뒤 signed URL을 발급한다.

### 5.1 Buckets

| Bucket | 공개 여부 | 용도 | 보존 정책 |
| --- | --- | --- | --- |
| `avatars` | private | 입력 이미지, AI 생성 모델, 썸네일, 관리자 샘플 모델을 통합 저장 | soft delete 후 30일 보관, 이후 영구 삭제 |

### 5.2 Object Path

논리 구조:

```text
storage/
├── images/
│   └── {user_id}/
│       └── {human_mesh_id}/
│           ├── front.jpg
│           ├── side.jpg
│           └── angle45.jpg
├── models/
│   └── {user_id}/
│       └── {human_mesh_id}/
│           ├── mesh.glb
│           └── admin_uploaded.glb
├── thumbnails/
│   └── {user_id}/
│       └── {human_mesh_id}/
│           ├── thumbnail.jpg
│           └── preview.jpg
└── admin/
    └── sample_models/
        └── {sample_id}/
            ├── mesh.glb
            └── thumbnail.jpg
```

| 파일 유형 | 경로 |
| --- | --- |
| 정면 이미지 | `images/{user_id}/{human_mesh_id}/front.{ext}` |
| 측면 이미지 | `images/{user_id}/{human_mesh_id}/side.{ext}` |
| 45도 이미지 | `images/{user_id}/{human_mesh_id}/angle45.{ext}` |
| AI 생성 모델 | `models/{user_id}/{human_mesh_id}/mesh.glb` |
| 관리자 업로드 모델 | `models/{user_id}/{human_mesh_id}/admin_uploaded.{glb|gltf}` |
| 썸네일 | `thumbnails/{user_id}/{human_mesh_id}/thumbnail.jpg` |
| Preview Render | `thumbnails/{user_id}/{human_mesh_id}/preview.jpg` |
| 관리자 샘플 모델 | `admin/sample_models/{sample_id}/mesh.{glb|gltf}` |
| 관리자 샘플 썸네일 | `admin/sample_models/{sample_id}/thumbnail.jpg` |
| provider 임시 결과 | `jobs/{user_id}/{generation_job_id}/raw/{filename}` |

### 5.3 파일 접근 정책

| 작업 | 정책 |
| --- | --- |
| 사진 업로드 | 인증 사용자는 자신의 `images/{user_id}/...` prefix에 `front`, `side`, `angle45` 이미지만 업로드 가능 |
| 모델 직접 업로드 | 일반 사용자는 불가. 관리자는 `models/{target_user_id}/...` 또는 `admin/sample_models/...`에 GLB/GLTF 업로드 가능 |
| 조회 | 인증 사용자만 자신의 파일에 대한 signed URL 요청 가능 |
| 다운로드 | 완료된 모델의 소유자만 GLB signed URL 발급 가능 |
| 관리자 교체/삭제 | 관리자는 사용자 모델을 교체하거나 삭제할 수 있으며 `admin_model_uploads`에 이력을 남긴다. |
| Soft Delete | 삭제 요청 시 object를 즉시 삭제하지 않고 DB에 `soft_deleted_at`, `purge_after`를 기록한다. |
| signed URL 만료 | 이미지/뷰어 미리보기 10분, 다운로드 5분 |

## 6. AI 아키텍처

MeshSelfie는 특정 AI 서비스에 종속되지 않도록 AI Provider Interface와 Provider Registry를 둔다. 비즈니스 로직은 `AIProvider` 인터페이스만 호출하고, 실제 Replicate, TRELLIS, Hunyuan3D, TripoSR, 자체 모델 연동은 provider adapter가 담당한다.

### 6.1 AI Provider Architecture

| 레이어 | 역할 |
| --- | --- |
| Application Service | 생성 요청 검증, 크레딧 차감, job 생성, 상태 전이 관리 |
| AI Provider Registry | 활성 Provider, 우선순위, 모델 버전, fallback Provider 선택 |
| AI Provider Interface | 모든 Provider adapter가 구현해야 하는 공통 계약 |
| Provider Adapter | Replicate, TRELLIS, Hunyuan3D, TripoSR, 자체 모델별 API 호출 구현 |
| Pipeline Worker | 전처리, AI 생성, 후처리, 썸네일 생성, Storage 저장 수행 |
| Observability | Provider별 성공률, 평균 생성 시간, 비용, 에러율 기록 |

### 6.2 AI Provider Interface

```ts
interface AIProvider {
  key: 'replicate' | 'trellis' | 'hunyuan3d' | 'triposr' | 'self_hosted'
  supports(input: GenerationInput): Promise<boolean>
  estimate(input: GenerationInput): Promise<GenerationEstimate>
  createJob(input: GenerationInput): Promise<ProviderJob>
  getJob(providerJobId: string): Promise<ProviderJobStatus>
  cancelJob(providerJobId: string): Promise<void>
  normalizeOutput(output: ProviderJobStatus): Promise<NormalizedMeshOutput>
}
```

공통 입력 구조:

| 필드 | 설명 |
| --- | --- |
| `front_image` | 필수 정면 이미지 signed URL 또는 provider 접근 URL |
| `side_image` | 선택 측면 이미지 |
| `side_direction` | 측면 방향, `left` 또는 `right` |
| `angle45_image` | 선택 45도 이미지 |
| `angle45_direction` | 45도 방향, `left` 또는 `right` |
| `generation_mode` | `photorealistic_human_mesh` 고정 |
| `quality_grade` | 입력 수 기반 `B`, `A`, `A+` |
| `output_format` | MVP는 `glb` |
| `user_id`, `job_id` | 추적용 내부 ID |

### 6.3 Provider Registry 구조

Provider Registry는 DB의 `ai_provider_versions`와 서버 설정을 조합해 활성 Provider를 선택한다.

| 항목 | 정책 |
| --- | --- |
| 우선순위 | `priority`가 낮은 active Provider를 우선 선택한다. |
| 다각도 지원 | `supports_multi_view = true`이고 `max_input_images >= input_image_count`인 Provider만 후보가 된다. |
| 비용 | `estimated_cost_per_job`과 사용자 크레딧 잔액을 비교한다. |
| 안정성 | `success_rate_rolling`이 운영 기준 미만이면 자동 후보 제외 가능하다. |
| 버전 고정 | 생성 job에는 `provider_version_id`, `model_name`, `model_version`을 저장해 재현성을 확보한다. |

지원 예정 Provider:

| Provider | 용도 |
| --- | --- |
| Replicate | 외부 모델 실행 gateway |
| Hybrid Head Worker | FLAME 계열 multi-view fitting, 피부 UV 합성, low-detail hair shell을 담당하는 기본 후보 |
| TRELLIS | 범용 3D asset fallback 및 품질 비교 |
| Hunyuan3D | 실사형 mesh 생성 후보 |
| TripoSR | 빠른 reconstruction 후보 |
| 자체 모델 | 비용/품질 최적화 후 장기 도입 |

### 6.4 Failover 전략

| 상황 | 전략 |
| --- | --- |
| Provider API 호출 실패 | 동일 Provider 재시도 1회 후 fallback Provider 선택 |
| 생성 timeout | job을 `failed`로 마킹하고 fallback job을 새로 생성 |
| output 형식 불일치 | postprocessing 단계에서 변환 시도, 실패 시 fallback |
| 품질 기준 미달 | 관리자 검수 또는 사용자 재생성 UX로 연결 |
| 전체 Provider 장애 | 사용자에게 지연 메시지를 표시하고 queued 상태 유지 |

Failover로 생성된 job은 `generation_jobs.failover_from_job_id`와 `attempt_no`로 연결한다.

### 6.5 AI 버전 관리 전략

| 항목 | 정책 |
| --- | --- |
| 모델 버전 저장 | 모든 생성 job에 provider, model_name, model_version, provider_version_id를 저장한다. |
| 점진 배포 | 새 Provider 버전은 관리자 설정으로 일부 traffic만 할당한다. |
| 롤백 | 실패율 또는 비용이 기준을 초과하면 이전 active version으로 되돌린다. |
| 품질 비교 | 동일 입력 이미지 세트로 Provider별 결과를 비교할 수 있게 metadata를 보존한다. |
| 비용 추적 | Provider version별 평균 비용과 성공률을 Admin Dashboard에 표시한다. |

## 7. 생성 파이프라인

생성 작업은 상태 전이를 명확히 관리한다. 사용자에게는 진행 단계 기반 상태 메시지를 표시하고, 관리자에게는 단계별 실패 원인을 노출한다.

### 7.1 단계

| 단계 | 상태 | 설명 |
| --- | --- | --- |
| 1. Upload | `queued` | 입력 이미지 업로드 및 job 생성 대기 |
| 2. Validation | `validating` | 얼굴 존재, 크기, 다중 인물, 흐림, 가림, 선글라스, 마스크 검증 |
| 3. Preprocessing | `preprocessing` | 이미지 리사이즈, crop, orientation 정규화, provider 입력 URL 생성 |
| 4. AI Generation | `generating` | 선택된 AI Provider에 생성 요청 및 상태 polling/webhook 처리 |
| 5. Post Processing | `postprocessing` | GLB 정합성 확인, 파일 크기/format 검증, 필요 시 변환/압축 |
| 6. Thumbnail Generation | `thumbnailing` | Preview Render와 thumbnail 생성 |
| 7. Storage Save | `thumbnailing` 또는 `postprocessing` | 모델, 썸네일, provider output을 Storage에 저장 |
| 8. Complete | `completed` | 다운로드/뷰어 URL 발급 가능 상태 |
| Error | `failed` | 실패 사유와 재시도 가능 여부 저장 |

### 7.2 상태값

| 상태 | 사용자 표시 |
| --- | --- |
| `queued` | 생성 요청을 준비 중입니다. |
| `validating` | 업로드한 사진 품질을 확인하고 있습니다. |
| `preprocessing` | AI 생성을 위해 사진을 정리하고 있습니다. |
| `generating` | 실사형 3D Human Mesh를 생성하고 있습니다. |
| `postprocessing` | 생성된 모델을 다운로드 가능한 GLB로 정리하고 있습니다. |
| `thumbnailing` | 미리보기 이미지를 생성하고 있습니다. |
| `completed` | 생성이 완료되었습니다. |
| `failed` | 생성에 실패했습니다. 안내에 따라 다시 시도해주세요. |

### 7.3 품질 등급 계산

| 입력 | 등급 |
| --- | --- |
| `front` | B |
| `front` + `side` | A |
| `front` + `angle45` | A |
| `front` + `side` + `angle45` | A+ |

품질 등급은 보장 품질이 아니라 입력 정보량 기반 예상 등급이다. 실제 결과 품질은 이미지 선명도, 얼굴 가림, Provider 품질에 따라 달라질 수 있다.

## 8. API 설계

Next.js App Router의 Route Handler를 사용하며 API 파일은 `app/api/**/route.ts` 또는 `src/app/api/**/route.ts`에 둔다. 모든 응답은 JSON을 기본으로 하고, 파일 다운로드는 signed URL 반환 방식으로 처리한다.

### 8.1 공통 응답

성공 응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| data | object 또는 array | 결과 데이터 |
| meta | object | 페이지네이션 등 부가 정보 |

에러 응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| error.code | string | 애플리케이션 에러 코드 |
| error.message | string | 사용자 노출 가능한 메시지 |
| error.details | object | 개발/검증용 부가 정보, production에서는 제한 |

공통 HTTP 상태:

| 상태 | 의미 |
| --- | --- |
| 400 | 잘못된 요청값 |
| 401 | 인증 필요 |
| 403 | 권한 없음 |
| 404 | 리소스 없음 |
| 409 | 중복 또는 상태 충돌 |
| 413 | 파일 크기 초과 |
| 415 | 지원하지 않는 파일 타입 |
| 429 | 사용량 제한 초과 |
| 500 | 서버 오류 |
| 502 | 외부 AI provider 오류 |

### 8.2 `GET /api/profile`

현재 로그인 사용자의 프로필을 조회한다.

요청:

| 항목 | 값 |
| --- | --- |
| Auth | Required |
| Body | 없음 |

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 사용자 ID |
| email | string | 이메일 |
| displayName | string 또는 null | 표시 이름 |
| meshCount | number | 전체 3D 모델 수 |
| completedMeshCount | number | 완료된 3D 모델 수 |
| dailyQuota | number | 일일 생성 한도 |
| remainingCredits | number | 남은 크레딧 |
| usedCredits | number | 사용한 크레딧 |
| todayGenerationCount | number | 오늘 생성 요청 수 |
| createdAt | string | 가입일 |

### 8.3 `POST /api/uploads/images`

정면/측면/45도 이미지 파일을 업로드하고 `source_images` 레코드를 생성한다. 정면 사진은 필수이며, 측면과 45도 사진은 선택이다.

요청:

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| frontImage | File | Y | 정면 JPG/PNG, 최대 10MB |
| sideImage | File | N | 왼쪽 또는 오른쪽 측면 JPG/PNG, 최대 10MB |
| sideDirection | string | N | `sideImage`가 있으면 필수, `left` 또는 `right` |
| angle45Image | File | N | 좌측 또는 우측 45도 JPG/PNG, 최대 10MB |
| angle45Direction | string | N | `angle45Image`가 있으면 필수, `left` 또는 `right` |

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| uploadSetId | uuid | 업로드 세트 ID 또는 임시 human mesh draft ID |
| frontSourceImageId | uuid | 정면 이미지 ID |
| sideSourceImageId | uuid 또는 null | 측면 이미지 ID |
| angle45SourceImageId | uuid 또는 null | 45도 이미지 ID |
| imageCount | number | 업로드된 사진 수 |
| qualityGrade | string | `B`, `A`, `A+` |
| validationResults | object | 슬롯별 검증 결과 |
| previewUrls | object | 슬롯별 10분 만료 signed URL |

주요 에러:

| 코드 | HTTP | 설명 |
| --- | --- | --- |
| `FRONT_IMAGE_REQUIRED` | 400 | 정면 사진 누락 |
| `TOO_MANY_IMAGES` | 400 | 허용 슬롯을 초과한 이미지 업로드 |
| `IMAGE_VALIDATION_FAILED` | 400 | 얼굴 없음, 다중 인물, 마스크 등 필수 검증 실패 |
| `FILE_TOO_LARGE` | 413 | 10MB 초과 |
| `UNSUPPORTED_FILE_TYPE` | 415 | JPG/PNG 아님 |
| `UPLOAD_FAILED` | 500 | Storage 업로드 실패 |

### 8.4 `POST /api/generate`

업로드된 이미지로 실사형 3D Human Mesh 생성을 요청한다.

요청:

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| frontSourceImageId | uuid | Y | 정면 이미지 ID |
| sideSourceImageId | uuid | N | 측면 이미지 ID |
| angle45SourceImageId | uuid | N | 45도 이미지 ID |
| modelProvider | string | N | Provider Registry가 기본 선택 |
| modelName | string | N | 기본 모델, MVP 환경 변수로 제어 |
| generationMode | string | N | 기본 `photorealistic_human_mesh`, 다른 스타일 모드는 MVP에서 허용하지 않음 |

AI provider 입력 구조:

| 필드 | 전달 조건 |
| --- | --- |
| `front_image` | 항상 전달 |
| `side_image` | 측면 사진이 있는 경우만 전달 |
| `side_direction` | 측면 사진이 있는 경우만 전달 |
| `angle45_image` | 45도 사진이 있는 경우만 전달 |
| `angle45_direction` | 45도 사진이 있는 경우만 전달 |

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| meshId | uuid | 생성될 실사형 3D 모델 ID |
| generationJobId | uuid | 작업 ID |
| status | string | 초기 상태, 일반적으로 `queued` |
| qualityGrade | string | `B`, `A`, `A+` |
| selectedProvider | string | Provider Registry가 선택한 Provider |
| estimatedGenerationCost | number 또는 null | 예상 생성 비용 |
| usedCredits | number | 차감 예정 또는 차감된 크레딧 |
| estimatedSeconds | number 또는 null | 예상 소요 시간 |

주요 에러:

| 코드 | HTTP | 설명 |
| --- | --- | --- |
| `FRONT_IMAGE_REQUIRED` | 400 | 정면 이미지 ID 누락 |
| `SOURCE_IMAGE_NOT_FOUND` | 404 | 소유한 이미지가 아님 또는 없음 |
| `INVALID_IMAGE_ROLE` | 400 | 슬롯과 이미지 role이 일치하지 않음 |
| `ACTIVE_JOB_EXISTS` | 409 | 같은 사진 조합으로 진행 중인 작업 존재 |
| `DAILY_QUOTA_EXCEEDED` | 429 | 일일 생성 한도 초과 |
| `INSUFFICIENT_CREDITS` | 402 | 크레딧 부족 |
| `AI_PROVIDER_FAILED` | 502 | AI Provider 요청 실패 |

### 8.5 `GET /api/generation-jobs/{jobId}`

생성 작업 상태를 조회한다. 필요 시 Replicate 상태와 DB 상태를 동기화한다.

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| generationJobId | uuid | 작업 ID |
| meshId | uuid | 실사형 3D 모델 ID |
| status | string | 현재 상태 |
| progress | number 또는 null | 진행률 |
| pipelineStage | string | 현재 pipeline 단계 |
| selectedProvider | string | 사용 중인 Provider |
| errorMessage | string 또는 null | 실패 메시지 |
| createdAt | string | 생성일 |
| updatedAt | string | 수정일 |

### 8.6 `GET /api/meshes`

현재 사용자의 실사형 3D 모델 목록을 조회한다.

Query:

| 필드 | 타입 | 기본값 | 설명 |
| --- | --- | --- | --- |
| status | string | 없음 | 상태 필터 |
| limit | number | 20 | 최대 50 |
| cursor | string | 없음 | 페이지네이션 커서 |

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| items | array | 3D 모델 목록 |
| nextCursor | string 또는 null | 다음 페이지 커서 |

3D 모델 목록 아이템:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 모델 ID |
| title | string | 표시명 |
| status | string | 상태 |
| imageCount | number | 사용된 사진 수 |
| qualityGrade | string | `B`, `A`, `A+` |
| modelSource | string | `ai_generated` 또는 `admin_uploaded` |
| thumbnailUrl | string 또는 null | signed URL |
| createdAt | string | 생성일 |
| completedAt | string 또는 null | 완료일 |
| generationMode | string | `photorealistic_human_mesh` |

### 8.7 `GET /api/meshes/{meshId}`

실사형 3D 모델 상세 정보를 조회한다.

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | uuid | 모델 ID |
| status | string | 상태 |
| inputImages | object | `front`, `side`, `angle45` signed URL |
| imageCount | number | 사용된 사진 수 |
| qualityGrade | string | `B`, `A`, `A+` |
| modelSource | string | `ai_generated` 또는 `admin_uploaded` |
| modelViewUrl | string 또는 null | 뷰어용 GLB signed URL |
| thumbnailUrl | string 또는 null | 썸네일 signed URL |
| thumbnailGeneratedAt | string 또는 null | 썸네일 생성 시각 |
| generationJob | object | 최신 작업 정보 |
| qualityNotes | object 또는 null | 얼굴 유사도, 텍스처 품질, 입력 각도 수에 따른 생성 한계 등 품질 메타데이터 |
| createdAt | string | 생성일 |
| completedAt | string 또는 null | 완료일 |

### 8.8 `GET /api/meshes/{meshId}/download`

완료된 GLB 모델의 다운로드 URL을 발급한다.

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| downloadUrl | string | 5분 만료 signed URL |
| filename | string | 다운로드 파일명 |
| expiresIn | number | 만료 초 |

주요 에러:

| 코드 | HTTP | 설명 |
| --- | --- | --- |
| `MESH_NOT_READY` | 409 | 아직 완료되지 않음 |
| `MODEL_NOT_FOUND` | 404 | 모델 파일 없음 |

### 8.9 `POST /api/webhooks/ai-provider`

AI Provider 웹훅을 받아 작업 상태와 결과 파일을 동기화한다. Provider별 webhook path가 필요한 경우 `/api/webhooks/replicate`, `/api/webhooks/hunyuan3d`처럼 adapter route를 둘 수 있으나 내부 처리는 동일한 webhook service로 위임한다.

요청:

| 항목 | 설명 |
| --- | --- |
| Auth | Provider webhook signature 또는 secret token 검증 |
| Body | Provider job payload |

처리:

| 단계 | 설명 |
| --- | --- |
| 1 | signature 또는 secret 검증 |
| 2 | `provider_prediction_id`로 generation job 조회 |
| 3 | 상태를 pipeline 상태값으로 갱신 |
| 4 | 완료 시 output GLB를 서버에서 다운로드 |
| 5 | `avatars` bucket의 `models/{user_id}/{human_mesh_id}/mesh.glb`에 업로드 |
| 6 | `human_meshes`와 `generation_jobs`를 완료 상태로 갱신 |

### 8.10 `GET /api/gallery`

Landing Page Gallery에 노출할 Featured Mesh 목록을 조회한다.

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| items | array | Featured Mesh 목록 |
| items[].meshId | uuid | 모델 ID |
| items[].thumbnailUrl | string | 썸네일 signed URL 또는 public proxy URL |
| items[].qualityGrade | string | 품질 등급 |
| items[].modelSource | string | 생성 방식 |

### 8.11 `POST /api/admin/models/upload`

관리자가 특정 사용자 또는 샘플 용도로 GLB/GLTF 모델을 직접 업로드한다.

요청:

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| targetUserId | uuid | N | 사용자 모델로 등록할 경우 대상 사용자 ID |
| humanMeshId | uuid | N | 기존 모델 교체 시 대상 모델 ID |
| modelFile | File | Y | GLB 또는 GLTF |
| purpose | string | Y | `replace_failed`, `external_tool`, `test_data`, `sample`, `quality_replacement` |
| reason | string | N | 관리자 작업 사유 |

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| humanMeshId | uuid | 생성 또는 교체된 모델 ID |
| modelSource | string | `admin_uploaded` |
| modelObjectPath | string | Storage path |
| adminUploadId | uuid | 감사 이력 ID |

### 8.12 `PATCH /api/admin/models/{meshId}`

관리자가 기존 사용자 모델을 새 업로드 모델로 교체하거나 메타데이터를 수정한다.

요청:

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| modelFile | File | N | 교체할 GLB/GLTF |
| status | string | N | `completed`, `failed`, `canceled` |
| reason | string | Y | 작업 사유 |

### 8.13 `DELETE /api/admin/models/{meshId}`

관리자가 잘못된 모델을 삭제 또는 비활성화한다. 물리 삭제 전 `admin_model_uploads`에 이력을 남기고, MVP에서는 기본적으로 DB 상태를 `canceled` 또는 `deleted`에 준하는 soft delete 정책으로 처리한다.

### 8.14 `GET /api/admin/models`

관리자가 사용자 모델과 생성 실패 모델을 조회한다.

Query:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| userId | uuid | 특정 사용자 필터 |
| status | string | 생성 상태 필터 |
| modelSource | string | `ai_generated`, `admin_uploaded` |
| failedOnly | boolean | 실패 모델만 조회 |
| q | string | 이메일 또는 모델 ID 검색 |

### 8.15 `GET /api/admin/metrics`

관리자 대시보드의 운영 지표를 조회한다.

응답:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| totalUsers | number | 전체 사용자 수 |
| totalGenerations | number | 전체 생성 수 |
| failureRate | number | 실패율 |
| recentJobs | array | 최근 생성 작업 |
| providerUsage | array | Provider별 사용량 |
| providerSuccessRates | array | Provider별 성공률 |

## 9. 권한 설계

권한은 Supabase Auth 사용자 ID와 `profiles.role`을 기준으로 구분한다. 기본 role은 `user`이며, 운영자가 DB 또는 관리자 도구를 통해 `admin`으로 승격한 계정만 관리자 기능을 사용할 수 있다.

### 9.1 역할별 권한

| 기능 | 일반 사용자 | 관리자 |
| --- | --- | --- |
| 사진 업로드 | 가능 | 가능 |
| AI 생성 요청 | 가능 | 가능 |
| 생성 결과 조회 | 자신의 모델만 가능 | 전체 사용자 모델 조회 가능 |
| GLB 다운로드 | 자신의 완료 모델만 가능 | 전체 모델 다운로드 가능 |
| 3D 모델 직접 업로드 | 불가 | 가능 |
| 사용자 모델 교체 | 불가 | 가능 |
| 사용자 모델 삭제 | 불가 | 가능 |
| 샘플 모델 등록 | 불가 | 가능 |
| 생성 실패 모델 관리 | 자신의 실패 결과 확인만 가능 | 전체 실패 모델 관리 가능 |

### 9.2 API 권한 정책

| API 그룹 | 권한 |
| --- | --- |
| `/api/profile` | 인증 사용자 |
| `/api/uploads/images` | 인증 사용자, 자신의 이미지 prefix만 |
| `/api/generate` | 인증 사용자, 자신의 이미지 ID만 |
| `/api/meshes/**` | 인증 사용자, 자신의 모델만 |
| `/api/admin/**` | `profiles.role = 'admin'`인 사용자만 |
| `/api/webhooks/**` | provider signature 또는 webhook secret 검증 |

### 9.3 Storage 권한 정책

| 경로 | 일반 사용자 | 관리자 |
| --- | --- | --- |
| `images/{user_id}/...` | 자신의 경로에 사진 업로드/조회 가능 | 전체 조회 가능 |
| `models/{user_id}/mesh.glb` | 직접 업로드 불가, signed URL 조회/다운로드만 가능 | 조회/교체/삭제 가능 |
| `models/{user_id}/admin_uploaded.{glb|gltf}` | 직접 업로드 불가, 소유 모델이면 다운로드 가능 | 업로드/교체/삭제 가능 |
| `thumbnails/{user_id}/...` | 자신의 썸네일 조회 가능 | 전체 조회/재생성 가능 |
| `admin/sample_models/...` | Gallery에 노출된 signed URL 조회만 가능 | 등록/교체/삭제 가능 |

### 9.4 RLS 운영 원칙

| 원칙 | 설명 |
| --- | --- |
| 사용자 격리 | 일반 사용자는 `auth.uid() = user_id` 조건을 만족하는 레코드만 조회한다. |
| 관리자 우회 | 관리자 API는 서버에서 role을 검증한 뒤 service role client로 필요한 작업을 수행한다. |
| 감사 로그 | 관리자 모델 업로드, 교체, 삭제는 `admin_model_uploads`와 `usage_events`에 기록한다. |
| 파일 URL | DB에는 영구 public URL이 아니라 Storage path를 저장하고, 접근 시 signed URL을 발급한다. |

## 10. 관리자 기능

관리자 기능은 MVP 운영 안정성과 품질 보정을 위한 내부 도구다. 일반 사용자에게 노출하지 않는다.

| 기능 | 설명 |
| --- | --- |
| 사용자 검색 | 이메일, 사용자 ID, 모델 ID로 사용자를 검색한다. |
| 전체 사용자 수 | 가입 사용자 수와 활성 사용자 수를 확인한다. |
| 전체 생성 수 | 전체 생성 job 수와 완료 모델 수를 확인한다. |
| 실패율 | 전체 실패율과 최근 24시간 실패율을 확인한다. |
| 최근 생성 작업 | 최근 job 상태, Provider, 소요 시간, 실패 사유를 확인한다. |
| AI Provider 사용 통계 | Provider별 job 수, 평균 생성 시간, 평균 비용을 확인한다. |
| AI Provider별 성공률 | Provider version별 rolling success rate를 확인한다. |
| 생성 현황 조회 | 사용자별 생성 수, 진행 중 작업, 실패 작업, 관리자 업로드 여부를 확인한다. |
| 모델 업로드 | GLB/GLTF 파일을 사용자 모델 또는 샘플 모델로 등록한다. |
| 모델 교체 | AI 생성 실패 또는 품질 미달 모델을 관리자 업로드 모델로 교체한다. |
| 모델 삭제 | 잘못된 모델을 삭제 또는 비활성화하고 사유를 기록한다. |
| 실패 모델 관리 | `failed` 상태 작업을 모아 확인하고 수동 업로드 또는 재시도를 결정한다. |
| 샘플 모델 등록 | 랜딩/데모/QA에 사용할 실사형 Human Mesh 샘플을 등록한다. |
| Featured Mesh 지정 | Gallery에 노출할 모델을 지정하거나 해제한다. |
| 감사 로그 확인 | 관리자 작업 이력을 조회한다. |

관리자 업로드 포맷:

| 포맷 | MVP 지원 | 비고 |
| --- | --- | --- |
| GLB | 지원 | 기본 다운로드/뷰어 포맷 |
| GLTF | 지원 | 텍스처 외부 참조 처리 정책 필요 |
| FBX | 향후 | 후처리 파이프라인 필요 |
| OBJ | 향후 | 텍스처/MTL 처리 정책 필요 |

## 11. 화면 설계

### 11.1 Landing Page `/`

목적: 비로그인 사용자가 MeshSelfie의 핵심 가치를 이해하고 가입 또는 로그인을 시작한다.

주요 UI:

| 영역 | 요소 |
| --- | --- |
| Hero | 서비스명, "여러 각도 얼굴 사진으로 실사형 3D 스캔 모델 생성" 가치 제안, `Get Started`, `Login` 버튼 |
| Demo Preview | 실사형 Human Mesh 예시 이미지 또는 짧은 뷰어 미리보기 |
| Gallery | 관리자가 Featured로 지정한 Human Mesh 썸네일과 품질 등급 |
| How it works | Upload, Generate, Download 3단계 |
| FAQ | 필수/선택 사진, 파일 형식, 생성 시간, 다운로드 가능 여부, 사진 각도에 따른 품질 차이 |

### 11.2 Login `/login`

주요 UI:

| 요소 | 설명 |
| --- | --- |
| 이메일 입력 | 이메일 형식 검증 |
| 비밀번호 입력 | 최소 길이 검증 |
| 로그인 버튼 | 제출 중 로딩 상태 |
| 회원가입 링크 | `/signup` 이동 |
| 에러 메시지 | 잘못된 로그인 정보 표시 |

로그인 성공 시 `/dashboard`로 이동한다.

### 11.3 Signup `/signup`

주요 UI:

| 요소 | 설명 |
| --- | --- |
| 이메일 입력 | 이메일 형식 검증 |
| 비밀번호 입력 | 최소 길이와 확인 입력 |
| 약관 동의 | MVP에서는 필수 체크박스만 제공 |
| 회원가입 버튼 | 제출 중 로딩 상태 |
| 로그인 링크 | `/login` 이동 |

회원가입 성공 시 이메일 확인 정책에 따라 로그인 또는 확인 안내 화면을 표시한다.

### 11.4 Dashboard `/dashboard`

목적: 사용자의 생성 현황과 최근 실사형 3D 모델을 빠르게 확인한다.

주요 UI:

| 영역 | 요소 |
| --- | --- |
| Header | 사용자 이메일, Profile, Logout |
| Summary | 전체 모델 수, 완료 수, 진행 중 수, 오늘 남은 생성 횟수 |
| Primary Action | `Upload Photo` 버튼 |
| Model List | 썸네일, 상태 배지, 생성일, 사용된 이미지 수, 품질 등급, 생성 방식, View, Download |
| Empty State | 첫 업로드 유도 |

### 11.5 Upload Page `/upload`

목적: 정면 필수 사진과 선택 각도 사진을 업로드하고 생성 요청을 시작한다.

주요 UI:

| 영역 | 요소 |
| --- | --- |
| Front Upload | 정면 사진 업로드, 필수 표시, 예시 이미지, JPG/PNG 및 10MB 제한 안내 |
| Side Upload | 왼쪽 또는 오른쪽 측면 사진 업로드, 선택 표시, 방향 선택, 예시 이미지 |
| 45 Degree Upload | 좌측 또는 우측 45도 사진 업로드, 선택 표시, 방향 선택, 예시 이미지 |
| Preview | 슬롯별 업로드 이미지 미리보기와 삭제/교체 버튼 |
| Validation | 얼굴 존재, 얼굴 크기, 다중 인물, 흐림, 가림, 선글라스, 마스크 검증 결과와 사용자 친화 메시지 |
| Generate Button | 정면 사진 업로드 후 활성화, 버튼 문구는 `Generate 3D Scan` 또는 `Generate Human Mesh` |
| Progress | 업로드 중 진행 상태 |

입력 사진 가이드:

| 항목 | 권장 |
| --- | --- |
| 정면 | 얼굴이 카메라를 정면으로 바라보는 사진, 필수 |
| 측면 | 왼쪽 또는 오른쪽 측면 사진, 선택 |
| 45도 | 좌측 또는 우측 45도 사진, 선택 |
| 조명 | 얼굴 전체가 균일하게 보이는 밝은 조명 |
| 가림 | 선글라스, 마스크, 큰 모자 등 얼굴 가림 최소화 |
| 배경 | 얼굴 경계가 잘 보이는 단순한 배경 |
| 품질 | 흔들림과 심한 필터가 없는 원본에 가까운 사진 |

생성 요청 성공 시 `/meshes/{meshId}`로 이동한다.

### 11.6 Result Page `/meshes/{meshId}`

목적: 생성 상태와 결과 실사형 3D Human Mesh를 확인한다.

주요 UI:

| 상태 | UI |
| --- | --- |
| queued/validating/preprocessing | 단계별 진행 메시지, 슬롯별 입력 이미지 |
| generating/postprocessing/thumbnailing | 진행 중 상태, 자동 갱신, Provider와 pipeline 단계 표시 |
| completed | 3D 뷰어, 다운로드 버튼, 사용된 이미지 수, 품질 등급, 생성 방식, 생성 메타데이터 |
| failed | 실패 메시지, 다시 시도 버튼, Dashboard 이동 |

3D 뷰어 컨트롤:

| 컨트롤 | 설명 |
| --- | --- |
| Orbit | 드래그 회전 |
| Zoom | 휠/핀치 확대 축소 |
| Reset View | 기본 카메라 위치 복귀 |
| Download | GLB 다운로드 URL 요청 |

결과 검수 포인트:

| 항목 | 설명 |
| --- | --- |
| 얼굴 유사도 | 얼굴형, 눈/코/입 위치와 비율을 원본 이미지와 비교할 수 있어야 한다. |
| 텍스처 | 피부 톤과 식별 가능한 얼굴 특징이 과도하게 변형되지 않았는지 확인할 수 있어야 한다. |
| 실사성 | 카툰, 게임 캐릭터, VRM 캐릭터처럼 보이지 않는 실사형 모델이어야 한다. |
| 입력 활용 | 측면/45도 사진을 추가한 경우 머리 형상과 측면 구조가 더 잘 보존되었는지 확인할 수 있어야 한다. |

### 11.7 Profile Page `/profile`

주요 UI:

| 영역 | 요소 |
| --- | --- |
| Account | 이메일, 가입일 |
| Usage | 오늘 생성 횟수, 일일 한도, 전체 완료 모델 수 |
| Recent Activity | 최근 업로드/생성/다운로드 이벤트 |
| Logout | 세션 종료 |

### 11.8 Admin Dashboard `/admin`

목적: 관리자가 사용자 생성 현황을 확인하고, 실패 또는 품질 미달 모델을 직접 업로드/교체/삭제한다.

주요 UI:

| 영역 | 요소 |
| --- | --- |
| User Search | 이메일, 사용자 ID, 모델 ID 검색 |
| Generation Overview | 전체 생성 수, 진행 중 수, 실패 수, 관리자 업로드 수 |
| Failed Models | 실패한 생성 작업 목록, 에러 메시지, 재시도/업로드 액션 |
| Provider Metrics | Provider별 사용량, 성공률, 평균 비용, 평균 생성 시간 |
| Model Upload | GLB/GLTF 파일 업로드, 대상 사용자/모델 선택, 업로드 목적 선택 |
| Model Replace | 기존 모델 미리보기, 새 모델 업로드, 교체 사유 입력 |
| Model Delete | 삭제 또는 비활성화 사유 입력, 확인 모달 |
| Sample Models | 샘플 모델 등록 및 목록 관리 |
| Audit Log | 관리자 업로드/교체/삭제 이력 |

관리자 모델 업로드 폼:

| 필드 | 설명 |
| --- | --- |
| 대상 | 사용자 모델 또는 샘플 모델 선택 |
| 사용자 | 이메일 또는 사용자 ID 검색 |
| 기존 모델 | 교체 대상 모델 선택 |
| 파일 | GLB/GLTF 업로드 |
| 목적 | AI 실패 대응, 외부 툴 등록, 테스트 데이터, 샘플, 품질 개선 |
| 사유 | 감사 로그용 텍스트 |

## 12. 폴더 구조

현재 프로젝트는 루트 `app` 디렉터리를 사용한다. MVP 확장 시 `src` 디렉터리를 도입하거나, 현재 구조를 유지해도 된다. 신규 개발 기준 권장 구조는 다음과 같다.

```text
.
├── app
│   ├── (auth)
│   │   ├── login
│   │   │   └── page.tsx
│   │   └── signup
│   │       └── page.tsx
│   ├── (dashboard)
│   │   ├── dashboard
│   │   │   └── page.tsx
│   │   ├── upload
│   │   │   └── page.tsx
│   │   ├── meshes
│   │   │   └── [meshId]
│   │   │       └── page.tsx
│   │   └── profile
│   │       └── page.tsx
│   ├── gallery
│   │   └── page.tsx
│   ├── admin
│   │   └── page.tsx
│   ├── api
│   │   ├── profile
│   │   │   └── route.ts
│   │   ├── uploads
│   │   │   └── images
│   │   │       └── route.ts
│   │   ├── generate
│   │   │   └── route.ts
│   │   ├── gallery
│   │   │   └── route.ts
│   │   ├── generation-jobs
│   │   │   └── [jobId]
│   │   │       └── route.ts
│   │   ├── meshes
│   │   │   ├── route.ts
│   │   │   └── [meshId]
│   │   │       ├── route.ts
│   │   │       └── download
│   │   │           └── route.ts
│   │   ├── webhooks
│   │   │   ├── ai-provider
│   │   │   │   └── route.ts
│   │   │   └── replicate
│   │   │       └── route.ts
│   │   └── admin
│   │       ├── models
│   │       │   ├── route.ts
│   │       │   ├── upload
│   │       │   │   └── route.ts
│   │       │   └── [meshId]
│   │       │       └── route.ts
│   │       ├── users
│   │       │   └── route.ts
│   │       └── metrics
│   │           └── route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components
│   ├── admin
│   ├── auth
│   ├── dashboard
│   ├── upload
│   ├── viewer
│   └── ui
├── hooks
│   ├── use-mesh-status.ts
│   └── use-session.ts
├── lib
│   ├── ai
│   │   ├── interface.ts
│   │   ├── registry.ts
│   │   └── providers
│   │       ├── replicate.ts
│   │       ├── trellis.ts
│   │       ├── hunyuan3d.ts
│   │       └── triposr.ts
│   ├── env.ts
│   ├── pipeline
│   │   ├── validation.ts
│   │   ├── preprocessing.ts
│   │   ├── postprocessing.ts
│   │   └── thumbnails.ts
│   ├── supabase
│   │   ├── browser.ts
│   │   ├── server.ts
│   │   └── admin.ts
│   ├── storage.ts
│   ├── validation.ts
│   └── errors.ts
├── types
│   ├── mesh.ts
│   ├── api.ts
│   └── database.ts
├── docs
│   └── meshselfie-prd.md
└── public
```

구조 원칙:

| 원칙 | 설명 |
| --- | --- |
| Route Handler | Next.js App Router 규칙에 따라 API는 `app/api/**/route.ts`에 둔다. |
| Route Group | `(auth)`, `(dashboard)`로 URL 변경 없이 화면 성격을 분리한다. |
| Supabase Client | browser/server/admin client를 분리해 service role key가 클라이언트로 노출되지 않게 한다. |
| 3D Viewer | 브라우저 전용 의존성이므로 client component로 분리한다. |
| Validation | API별 입력 검증 스키마를 `lib/validation.ts` 또는 기능별 파일에 둔다. |
| Admin | 관리자 UI와 API는 role 검증을 공유 유틸로 분리한다. |

## 13. 개발 로드맵

### Phase 1: 프로젝트 기반과 인증

목표: 로그인 사용자가 보호 화면에 접근할 수 있는 기반을 만든다.

작업:

| 순서 | 작업 |
| --- | --- |
| 1 | Supabase 프로젝트 생성 및 Auth 설정 |
| 2 | 환경 변수 정리 |
| 3 | profiles 테이블, `role` 필드, 기본 RLS 적용 |
| 4 | `remaining_credits`, `used_credits`, `credit_ledger` 기반 비용 추적 스키마 적용 |
| 5 | Login, Signup, Logout 구현 |
| 6 | Dashboard 보호 라우트 구현 |
| 7 | Profile 조회 API와 화면 구현 |

완료 기준:

| 기준 | 설명 |
| --- | --- |
| 인증 | 이메일 가입/로그인/로그아웃이 동작한다. |
| 보안 | 비로그인 사용자는 Dashboard에 접근할 수 없다. |
| 프로필 | 로그인 사용자가 자신의 profile만 조회하고, 관리자는 관리자 화면 접근 권한을 가진다. |

### Phase 2: 업로드와 생성 작업

목표: 사용자가 정면 필수, 측면/45도 선택 사진을 업로드하고 품질 검증 후 AI 생성 작업을 시작할 수 있다.

작업:

| 순서 | 작업 |
| --- | --- |
| 1 | `avatars` Storage bucket과 `images/`, `models/` prefix 정책 적용 |
| 2 | source_images, human_meshes, generation_jobs, ai_provider_versions 테이블 생성 |
| 3 | `POST /api/uploads/images` 구현 |
| 4 | 얼굴 존재, 크기, 다중 인물, 흐림, 가림, 선글라스, 마스크 검증 구현 |
| 5 | 정면/측면/45도 슬롯 기반 Upload Page 구현 |
| 6 | AI Provider Interface와 Provider Registry 구현 |
| 7 | `front_image`, `side_image`, `angle45_image` 조건부 입력을 지원하는 `POST /api/generate` 구현 |
| 8 | pipeline 상태 조회 API 구현 |

완료 기준:

| 기준 | 설명 |
| --- | --- |
| 업로드 | 정면 1장 필수, 측면 1장 선택, 45도 1장 선택, 총 1~3장 업로드 가능 |
| 품질 검증 | 업로드 직후 이미지 품질 검증 결과가 저장되고 사용자 메시지가 표시된다. |
| 생성 요청 | 존재하는 사진만 AI 입력으로 전달되고 provider job ID가 저장된다. |
| 상태 조회 | queued/validating/preprocessing/generating/failed 상태가 화면에 표시된다. |

### Phase 3: 결과, 뷰어, 다운로드

목표: 생성 완료된 실사형 Human Mesh 모델을 저장하고 사용자가 뷰어와 다운로드를 사용할 수 있다.

작업:

| 순서 | 작업 |
| --- | --- |
| 1 | Provider webhook/polling 동기화 구현 |
| 2 | 완료 결과 GLB를 `avatars/models/{user_id}/{human_mesh_id}/mesh.glb`에 저장 |
| 3 | meshes 목록/상세 API 구현 |
| 4 | Preview Render와 Thumbnail 생성 구현 |
| 5 | 생성일, 상태, 사용된 이미지 수, 품질 등급, 썸네일, 생성 방식을 포함한 Dashboard 3D 모델 목록 구현 |
| 6 | Result Page 3D 뷰어 구현 |
| 7 | 다운로드 signed URL API 구현 |
| 8 | Gallery API와 Landing Gallery 구현 |
| 9 | 실패/재시도 UX 정리 |

완료 기준:

| 기준 | 설명 |
| --- | --- |
| 결과 저장 | 완료된 GLB가 `avatars` bucket의 `models/` 경로에 저장된다. |
| 썸네일 | Dashboard/Gallery/Admin에서 사용할 thumbnail이 생성된다. |
| 뷰어 | 브라우저에서 회전/확대/축소가 가능하다. |
| 다운로드 | 소유자만 GLB 다운로드가 가능하다. |

### Phase 4: 관리자 기능

목표: 관리자가 생성 실패와 품질 이슈를 수동으로 보정할 수 있다.

작업:

| 순서 | 작업 |
| --- | --- |
| 1 | `admin_model_uploads` 테이블과 감사 로그 구현 |
| 2 | `/api/admin/models/upload` 구현 |
| 3 | 관리자 모델 교체/삭제 API 구현 |
| 4 | 사용자 검색과 생성 현황 조회 API 구현 |
| 5 | Provider 사용 통계와 성공률 metrics API 구현 |
| 6 | Admin Dashboard 구현 |
| 7 | Featured Mesh 지정 기능 구현 |
| 8 | GLB/GLTF 업로드 검증과 signed URL 발급 구현 |

완료 기준:

| 기준 | 설명 |
| --- | --- |
| 관리자 업로드 | 관리자가 GLB/GLTF 모델을 사용자 모델 또는 샘플로 등록할 수 있다. |
| 모델 교체 | 실패/품질 미달 모델을 관리자 업로드 모델로 교체할 수 있다. |
| 감사 | 관리자 업로드/교체/삭제 이력이 저장된다. |
| Provider 통계 | 관리자 화면에서 Provider별 사용량과 성공률을 확인할 수 있다. |
| 권한 | 일반 사용자는 관리자 API와 모델 직접 업로드에 접근할 수 없다. |

### Phase 5: MVP 출시 준비

목표: 제한된 사용자에게 안정적으로 공개한다.

작업:

| 순서 | 작업 |
| --- | --- |
| 1 | Vercel production 배포 |
| 2 | Supabase production RLS 검증 |
| 3 | 사용량 제한과 에러 로그 정리 |
| 4 | Soft Delete와 30일 후 purge 운영 작업 점검 |
| 5 | 기본 SEO/OG 이미지 설정 |
| 6 | 운영 체크리스트와 수동 테스트 |

완료 기준:

| 기준 | 설명 |
| --- | --- |
| 배포 | production URL에서 전체 플로우 동작 |
| 보안 | 다른 사용자의 데이터와 파일에 접근 불가 |
| 운영 | 실패 작업을 추적하고 원인을 확인할 수 있음 |

## 14. 데이터 보관 정책

MeshSelfie는 얼굴 사진과 실사형 3D 모델을 다루므로 개인정보 보호와 삭제 요청 처리 정책을 명확히 둔다.

### 14.1 삭제 라이프사이클

| 단계 | 설명 |
| --- | --- |
| 사용자 삭제 요청 | 사용자가 모델 또는 계정 삭제를 요청한다. |
| Soft Delete | DB 레코드에 `soft_deleted_at`을 기록하고 일반 조회에서 제외한다. |
| 30일 보관 | 복구, 감사, 결제/분쟁 대응을 위해 30일간 private Storage에 보관한다. |
| 영구 삭제 | `purge_after` 이후 원본 이미지, 생성 모델, 썸네일, 작업 로그를 삭제 또는 익명화한다. |

### 14.2 삭제 대상

| 대상 | 처리 |
| --- | --- |
| 원본 이미지 | Storage object 삭제, `source_images` soft delete 후 purge |
| 생성 모델 | GLB/GLTF object 삭제, `human_meshes` soft delete 후 purge |
| 썸네일/Preview Render | thumbnails 경로 object 삭제 |
| 작업 로그 | provider 식별자와 에러 로그는 개인정보 제거 후 운영 통계만 보관 가능 |
| 크레딧 이력 | 회계/운영 목적의 최소 정보만 보관하고 얼굴 이미지 참조는 제거 |

### 14.3 개인정보 보호 원칙

| 원칙 | 설명 |
| --- | --- |
| Private Storage | 모든 원본 이미지와 모델은 private bucket에 저장한다. |
| Signed URL | 파일 접근은 만료 시간이 있는 signed URL로만 제공한다. |
| 최소 보관 | 서비스 제공과 장애 분석에 필요한 기간만 보관한다. |
| 관리자 접근 감사 | 관리자 모델 조회, 교체, 삭제는 감사 로그에 남긴다. |

## 15. 예상 리스크

| 리스크 | 영향 | 대응 |
| --- | --- | --- |
| AI Provider 모델 품질 편차 | 실사형 3D 스캔에 가까운 결과를 기대한 사용자가 결과에 실망할 수 있음 | 입력 사진 가이드 제공, Provider Registry와 모델 버전 관리, 결과 품질 한계 안내 |
| 캐릭터형 결과물 생성 | 서비스 포지셔닝과 다른 게임/만화풍 결과가 나올 수 있음 | 프롬프트와 모델 파라미터에서 photorealistic human mesh를 고정하고 스타일 변형 옵션을 비활성화 |
| 원본 인물 유사도 부족 | 얼굴 구조, 비율, 텍스처가 원본과 달라 신뢰도 하락 | 정면/고해상도 사진 권장, 품질 메타데이터 저장, 재생성 UX 검토 |
| 생성 시간 지연 | 이탈 증가 | 비동기 상태 UI, 이메일 알림은 후속 기능으로 검토 |
| AI 비용 증가 | MVP 운영 비용 초과 | 일일 생성 한도, 동시 작업 제한, 실패율 모니터링 |
| GLB 파일 용량 과다 | 뷰어 로딩 지연 | 파일 크기 제한, 후처리/압축은 후속 Phase로 검토 |
| 웹훅 누락 | 작업이 generating 또는 postprocessing에 고착 | 상태 동기화 API 또는 scheduled job 도입 |
| Storage 권한 오류 | 개인정보 노출 또는 다운로드 실패 | private bucket, signed URL, RLS와 prefix 정책 테스트 |
| 얼굴 사진 개인정보 | 민감 데이터 취급 부담 | 명확한 보관 정책, 삭제 기능, private 접근, 개인정보 처리방침 필요 |
| Vercel 함수 실행 시간 제한 | provider 결과 다운로드/업로드 실패 | 웹훅 처리 시간을 짧게 유지하고 필요 시 queue/worker 분리 |
| Next.js 15 변경점 | 구현 중 API 오용 | 프로젝트 내 `node_modules/next/dist/docs` 기준으로 구현 |

## 16. 향후 확장 전략

| 기능 | 설명 |
| --- | --- |
| 결제 | 무료 생성 한도 이후 유료 크레딧 또는 구독 제공 |
| 입력 사진 개선 가이드 | 얼굴 감지, 흐림 감지, 조명 품질 점수로 더 좋은 실사 메시 생성을 유도 |
| 추가 입력 각도 | `left45`, `right45`, `left_side`, `right_side`를 별도 슬롯으로 확장해 더 정밀한 머리/얼굴 형상 복원 지원 |
| 다중 모델 비교 | TRELLIS, Hunyuan3D, TripoSR, 자체 모델의 실사형 Human Mesh 결과 비교 |
| 자체 AI 모델 | 비용과 품질이 검증되면 self-hosted Provider로 전환 |
| 모델 후처리 | GLB 압축, 메시 정리, 텍스처 최적화 |
| 품질 평가 | 얼굴 구조 유사도, 텍스처 선명도, 실사성 점수를 내부 지표로 저장 |
| 공유 링크 | 공개 가능한 3D 모델 뷰어 링크 생성 |
| 사용자 셀프 삭제 UI | 사용자가 모델 삭제 요청과 30일 보관 상태를 직접 확인 |
| 이메일 알림 | 생성 완료/실패 알림 |
| 관리자 대시보드 | 실패율, 비용, 사용자별 사용량, Provider 상태 확인 고도화 |
| 팀/브랜드 계정 | 여러 사용자가 같은 workspace에서 실사형 3D 모델 관리 |
| API 상품화 | 외부 서비스가 MeshSelfie 생성 API를 호출할 수 있도록 제공 |
