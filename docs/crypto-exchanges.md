# منصّات التداول — المرجع المُتحقَّق (آب 2026)

تفاصيل API لقراءة الأرصدة، **مُتحقَّقة من الوثائق الرسمية** لا من الذاكرة.
كل منصّة توقيعُها ومساراتها مختلفة تماماً، وكتابة ستّة محوّلات من الذاكرة
تُنتج ستّة أخطاء صامتة — ولذلك يوجد هذا الملف.

المفاتيح **للقراءة فقط** في كل الحالات: التطبيق لا يتداول ولا يسحب، ومفتاحٌ
بصلاحية سحبٍ يضع محفظةً كاملة خلف خطأٍ برمجيّ واحد.

---

## جدول القرار السريع

| المنصّة | التوقيع | الطابع الزمني | مفاتيح | يعمل بلا IP ثابت؟ |
|---|---|---|---|---|
| Binance | HMAC-SHA256 → hex | ms epoch | key+secret | ✅ (سياسة الانتهاء غير محسومة) |
| Bybit | HMAC-SHA256 → hex | ms epoch | key+secret | ⚠️ **المفتاح ينتهي بعد 3 شهور** |
| OKX | HMAC-SHA256 → **base64** | **ISO-8601** | key+secret+**passphrase** | ✅ لمفتاح القراءة |
| Kraken | **HMAC-SHA512** → base64 | **nonce** متزايد | key+secret(b64) | ✅ الأنظف |
| Coinbase | **JWT** (EdDSA/ES256) | ثوانٍ، صلاحية دقيقتان | key id + private key | ✅ الأنظف |
| Pionex | HMAC-SHA256 → hex | ms، نافذة ±20 ثانية | key+secret | ❓ غير موثّق |

---

## عالَم الرقم — قبل أي كود

بعض المنصّات تعطي **تقييمها هي** بالدولار (`usdValue` عند Bybit، `totalEq`
و`eqUsd` عند OKX، `eb` عند Kraken)، وبعضها لا. وضربُ الكمية × سعرٍ من
`/ticker` تقييمٌ **نحسبه نحن**.

**خلطهما في مجموعٍ واحد يُنتج رقماً لا يطابق أيّ شاشة** — لا شاشة المنصّة ولا
شاشتنا. وهذا حرفياً ما تمنعه [قاعدة CLAUDE.md الثانية](../CLAUDE.md): عالَم
الرقم جزء من تعريفه.

**القرار المعتمد: نحسب نحن دائماً** (كمية × سعر من `/ticker` × سعر الصرف).
السبب: ستّ منصّات بعالمٍ واحد خيرٌ من ثلاثٍ بعالمين، والفرق بين تقييمنا
وتقييم المنصّة قروشٌ لا تُقارَن بثمن رقمٍ لا يُعرف من أين جاء.

---

## الرصيد الناقص صامتاً — أخطر ما في هذا الملف

**ثلاث منصّات تُخفي جزءاً من الرصيد خلف مسارٍ ثانٍ، وواحدة تُخفي جوهره:**

| المنصّة | ما يغيب عن المسار الرئيسي | المسار الذي يكشفه |
|---|---|---|
| Binance | Funding و Earn | `POST /sapi/v3/asset/getUserAsset` (الأقرب لمسارٍ جامع) |
| OKX | التمويل والادخار | `/api/v5/asset/balances` و`/api/v5/finance/savings/balance` |
| Bybit | محفظة التمويل (FUND) | `/v5/asset/transfer/query-account-coins-balance?accountType=FUND` |
| **Pionex** | البوتات وEarn عن `account/balances` | ✅ حُلَّ: نستعمل `wallet/balancesFull` (يشمل البوتات) — ويبقى **Earn خارجه** |

الوثائق تنصّ صراحةً أن `/api/v1/account/balances` عند Pionex
*"excludes bot and earn accounts"*. ومنصّة بوتات يُقرأ منها الـ spot وحده
تُخرج رقماً ناقصاً بلا أن تقول — وهو بالضبط صنف العطل الذي وُلد منه تدقيق
آب 2026.

---

## Binance

- **Base:** `https://api.binance.com`
- **المسار:** `GET /api/v3/account` (وزن 20)، و`POST /sapi/v3/asset/getUserAsset` (وزن 5) للصورة الأشمل.
- **التوقيع:** HMAC-SHA256 hex على `queryString + body` بلا فاصل، يُرسَل باراميتر `signature`.
- **الترويسة:** `X-MBX-APIKEY`.
- **الزمن:** `timestamp` بالملي، و`recvWindow` اختياري (افتراضي 5000، أقصى 60000).
- **الرد:** `balances[]` بحقول `asset` و`free` و`locked`. مفيد: `omitZeroBalances=true`.
- **الأسعار:** `GET /api/v3/ticker/price` بلا مصادقة → `{symbol, price}`.
- ⚠️ إعلان انتهاء صلاحية المفاتيح بلا IP **أُلغي رسمياً 2023-10-24** ولا بديل منشور — السياسة الحالية غير محسومة.

## Bybit

- **Base:** `https://api.bybit.com`
- **المسار:** `GET /v5/account/wallet-balance?accountType=UNIFIED`
- **التوقيع:** HMAC-SHA256 hex صغير على `timestamp + apiKey + recvWindow + queryString` (وللـPOST: الجسم بدل الـquery).
- **الترويسات:** `X-BAPI-API-KEY`، `X-BAPI-TIMESTAMP`، `X-BAPI-SIGN`، `X-BAPI-RECV-WINDOW`.
- **الرد:** `result.list[0].coin[]` بحقول `coin` و`walletBalance` (و`usdValue` — تقييم المنصّة، لا نستعمله).
- ⚠️ `availableToWithdraw` **مهجور** لـUNIFIED منذ 2025-01-09.
- ⚠️ **المفتاح بلا IP whitelist ينتهي بعد ثلاثة أشهر** → يحتاج تدويراً يدوياً.

## OKX

- **Base:** `https://www.okx.com` أو `https://openapi.okx.com` — **الوثائق متضاربة**، والنطاق الإقليمي إلزامي (EU: `eea.okx.com`، US/AU: `us.okx.com`) وإلا الخطأ `50119`.
- **المسارات الثلاثة:** `/api/v5/account/balance` (تداول) · `/api/v5/asset/balances` (تمويل) · `/api/v5/finance/savings/balance` (ادخار).
- **التوقيع:** Base64(HMAC-SHA256(`timestamp + METHOD + requestPath(+query) + body`)).
- **الترويسات:** `OK-ACCESS-KEY`، `OK-ACCESS-SIGN`، `OK-ACCESS-TIMESTAMP`، `OK-ACCESS-PASSPHRASE`.
- **الزمن:** **ISO-8601 بدقّة الملي** (`2020-12-08T09:08:57.715Z`) — لا ms epoch. أشهر مصدر أخطاء هنا.
- **الرد:** تداول `data[0].details[]` (`ccy`، `eq`)؛ تمويل `data[]` (`ccy`، `bal`).

## Kraken

- **Base:** `https://api.kraken.com/0`
- **المسار:** `POST /0/private/Balance` (POST لا GET).
- **التوقيع:** Base64(HMAC-SHA512(`urlPath + SHA256(nonce + body)`, base64decode(secret))).
- **الترويسات:** `API-Key`، `API-Sign`، والجسم `x-www-form-urlencoded`.
- **الزمن:** **nonce** متزايد دائماً (ms شائع) — لا طابع ولا نافذة.
  ⚠️ نداءان متوازيان قد يصلان معكوسين فيُرفض الأقل: نداءٌ واحد متسلسل.
- **الرد:** `result` **قاموس** لا مصفوفة: `{"ZUSD": "…", "XETH": "…"}` — ترميز Kraken يسبق الرموز بـ`X`/`Z`.
- **الصلاحية:** "Query Funds".

## Coinbase

- **Base:** `https://api.coinbase.com`
- **المسار:** `GET /api/v3/brokerage/accounts` (`limit` افتراضي 49، و`cursor` للصفحات).
- **المصادقة:** **JWT** لا HMAC: `Authorization: Bearer <jwt>`، خوارزمية **EdDSA** (موصى) أو ES256.
  - Header: `alg`، `typ: JWT`، `kid` = اسم المفتاح، `nonce` عشوائي.
  - Payload: `sub` = key id، `iss: "cdp"`، `nbf` = الآن، `exp` = `nbf + 120`، `uri` = `"GET api.coinbase.com/api/v3/brokerage/accounts"`.
  - ⚠️ الصلاحية **دقيقتان** → توليدٌ لكل نداء.
- **الرد:** `accounts[]` بحقول `currency` و`available_balance.value` و`hold.value` (الإجمالي = جمعهما).
- **الصلاحية:** View.
- ⚠️ تغطية أرصدة staking/Earn عبر هذا المسار **غير مؤكّدة**.

## Pionex — المنصّة المُنفَّذة

- **الوثائق الحالية:** `https://www.pionex.com/docs/api-docs` (وكل صفحة متاحة خاماً بإضافة `.md`، والفهرس في `/docs/llms.txt`). النطاق القديم `pionex-doc.gitbook.io` **مهجور**.
- **Base:** `https://api.pionex.com`
- **التوقيع:** HMAC-SHA256 hex على `METHOD + PATH + "?" + sortedQuery` — الباراميترات **مرتّبة ASCII بالمفتاح**، والطابع منها. مطابقٌ لكل مسارات Pionex بلا استثناء (spot و bot و earn و wallet).
- **الترويسات:** `PIONEX-KEY`، `PIONEX-SIGNATURE`.
- **الزمن:** ms في الـquery، **نافذة ±20 ثانية** فقط.
- ❓ لا ذكر لسياسة IP في الوثائق إطلاقاً.

### المسار المعتمد: `GET /api/v1/wallet/balancesFull`

```
data.totalInUsdt        ← المجموع المعتمد
data.totalInBtc
data.prices{coin → {priceInUsd, …}}
data.botAccount{totalInUsdt, detail[…]}     ← Spot (Bot Account)
data.traderAccount{totalInUsdt, detail[…]}  ← Futures (Trader Account)
```

**ولماذا هو لا `account/balances`:** الأخير موثَّقٌ صراحةً بأنه
*"excludes bot and earn accounts"* — ومنصّةُ بوتاتٍ يُقرأ سبوتُها وحده تُخرج
رقماً ناقصاً صامتاً.

**ولماذا نأخذ مجموعها لا نحسبه:** لا يوجد **أيّ** حقل «قيمة حالية» لبوت في
التوثيق؛ أقصى ما يُعطى مكوّنات العملة (`baseAmount` + `quoteAmount`)، وحقل
`buOrderData` في قائمة البوتات موصوفٌ حرفياً بأنه *"dynamic structure"* بلا
أنواع. فتركيبُ المجموع عندنا اختراعُ بنيةٍ غير موثَّقة — والمجموع الجاهز
يطابق ما يراه صاحبه في تطبيق المنصّة. **استثناءٌ معلَن** لقاعدة «نحن نحسب»،
مصرَّحٌ به في الكود وفي الواجهة (قاعدة CLAUDE.md الثانية).

⚠️ **تناقض في التوثيق:** صفحة `wallet-api/general-info/authentication` تكتب
المسار `/api/v1/balancesFull` وصلاحية `Trade reading`، بينما مواصفة OpenAPI
وصفحة الصلاحيات تقولان `/api/v1/wallet/balancesFull` وصلاحية `Enable reading`.
المصدران الأخيران أرجح (اتفاقهما + كونهما المواصفة).

### ما يبقى خارج المجموع

`balancesFull` نطاقُه *"Spot (Bot Account) and Futures (Trader Account)"* —
و**Earn غير مذكور**. مساراه:

- `GET /api/v1/earn/dual/balances` — منمَّط: `data.balances[]` بحقول `base`، `coin`، `free`، `frozen`. (بارامتر `merge=true` يدمج العملة عبر عملات الأساس.)
- `GET /api/v1/earn/arbitrage/fetchUserBalances` — ⚠️ **بلا أسماء حقول موثَّقة إطلاقاً** (`pass-through of the upstream gRPC`). لا يُبنى عليه بلا مفتاح حقيقي يكشف شكله.

الصلاحية لقراءة Earn هي **Enable reading** لا `Earn` (تلك للـstake/invest).
وقراءة البوتات تفصيلاً تحتاج **Bot reading**، ولا نحتاجها ما دام المجموع كافياً.

### الترقيم

`pageToken` طلباً و`nextPageToken`/`previousPageToken` رداً — **بلا حجم صفحة
ولا عدد إجمالي**، فلا يُعرف كم بقي حتى تنتهي الرموز.

---

## ما لم يُتحقَّق منه

يُذكَر صراحةً كي لا يُبنى عليه:

- Binance Simple Earn: المسارات مذكورة في الفهرس ولم تُفتح صفحاتها للتأكّد.
- Pionex: شكل `earn/arbitrage/fetchUserBalances` — بلا حقولٍ موثَّقة.
- Pionex: هل يشمل `botAccount` رأسمال البوتات الجارية أم أرصدةً حرّة فقط؟ عدّاد `detail[].type` غير موثَّق.
- Coinbase: تغطية staking.
- Binance: سياسة انتهاء المفاتيح بلا IP بعد إلغاء إعلان 2021.
