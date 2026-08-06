/**
 * Supabase مزيّف في الذاكرة — لفحص خادم MCP بلا حساب حقيقي.
 *
 * لماذا لا نفحص على القاعدة الحقيقية؟ نفعل، حين تتوفّر (`npm run check:mcp`
 * يلتقط بيانات .env). لكن فحصاً يشترط حساباً وشبكةً لا يُشغَّل في CI ولا على
 * جهاز مساهم جديد، فيبقى الخادم بلا شبكة أمان في أكثر الأوقات حاجةً إليها.
 * هذا الملف يجعل الفحص الكامل — كل الأدوات، قراءةً وكتابةً — يعمل في أي
 * مكان بلا إعداد.
 *
 * يغطّي ما يستعمله الخادم من PostgREST لا أكثر: eq و gte و order و limit،
 * والإدراج والتحديث والدمج، والمشاهد الثلاثة محسوبةً عند القراءة. أي استعمال
 * خارج ذلك يردّ 400 برسالة صريحة بدل أن يمرّ صامتاً — فحصٌ يكذب أسوأ من لا فحص.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const EMAIL = 'check@sanawi.local'
const PASSWORD = 'check-password'
const USER_ID = '00000000-0000-4000-8000-00000000f00d'
const ANON_KEY = 'fake-anon-key'

/*
 * حسابان لا واحد.
 *
 * OAuth يجعل خادماً واحداً يخدم كل المستخدمين، فالسؤال الذي يجب أن يجيب عنه
 * الفحص صار: هل يرى مستخدمٌ صفَّ غيره؟ حسابٌ واحد لا يستطيع أن يجيب. الثاني
 * هنا موجود لهذا الغرض وحده.
 */
const OTHER_EMAIL = 'other@sanawi.local'
const OTHER_PASSWORD = 'other-password'
const OTHER_USER_ID = '00000000-0000-4000-8000-00000000beef'

const ACCOUNTS = [
  { id: USER_ID, email: EMAIL, password: PASSWORD },
  { id: OTHER_USER_ID, email: OTHER_EMAIL, password: OTHER_PASSWORD },
]

/** JWT غير موقّع — الشكل وحده يهمّ: الخادم يقرأ `sub` منه ويمرّره كما هو. */
const makeJwt = (sub, expiresAt) => {
  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp: expiresAt, role: 'authenticated' })}.fake`
}

const round2 = (v) => Math.round(v * 100) / 100
const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** الجداول: مصفوفات بسيطة. لا فهارس ولا قيود — الفحص يفحص الخادم لا Postgres. */
function seed() {
  return {
    profiles: [
      {
        id: USER_ID,
        display_name: 'حساب الفحص',
        currency: 'ILS',
        locale: 'ar',
        country: 'IL',
        theme_preference: 'system',
        onboarding_completed: true,
        monthly_savings_target: 500,
        created_at: new Date().toISOString(),
      },
      {
        id: OTHER_USER_ID,
        display_name: 'حساب ثانٍ',
        currency: 'USD',
        locale: 'ar',
        country: 'IL',
        theme_preference: 'system',
        onboarding_completed: true,
        monthly_savings_target: 0,
        created_at: new Date().toISOString(),
      },
    ],
    obligation_groups: [],
    obligations: [],
    obligation_partners: [],
    obligation_partner_shares: [],
    fund_deposits: [],
    obligation_payments: [],
    income_sources: [],
    fixed_commitments: [],
    expenses: [],
    events: [],
    bill_payments: [],
    /* صفوف نظامٍ بلا `user_id`: يراها الجميع، وعليها تعتمد الشاشات. */
    expense_categories: [
      { id: randomUUID(), user_id: null, name_ar: 'أكل', icon: '🍽️', sort_order: 10 },
      { id: randomUUID(), user_id: null, name_ar: 'بنزين', icon: '⛽', sort_order: 20 },
    ],
    payment_methods: [
      { id: randomUUID(), user_id: null, name_ar: 'نقداً', icon: '💵', is_automatic: false, sort_order: 10 },
      { id: randomUUID(), user_id: null, name_ar: 'أوتوماتيك', icon: '🔁', is_automatic: true, sort_order: 20 },
    ],
    income_entries: [],
    assets: [],
    net_worth_snapshots: [],
    accounts: [],
    account_transfers: [],
    account_settlements: [],
    commitment_partner_shares: [],
    commitment_templates: [
      {
        id: randomUUID(),
        name_ar: 'إنترنت',
        category: 'home',
        icon: '🌐',
        suggested_min: 80,
        suggested_max: 200,
        is_installment: false,
        hint: 'خط الإنترنت ومعه التلفزيون إن كانا بحزمة واحدة.',
        sort_order: 10,
      },
    ],
    obligation_templates: [
      {
        id: randomUUID(),
        name_ar: 'تأمين السيارة',
        name_he: 'ביטוח רכב',
        name_en: 'Car insurance',
        category: 'car',
        icon: '🚗',
        default_recurrence_months: 12,
        suggested_min: 2500,
        suggested_max: 9000,
        hint: 'إجباري وطرف ثالث أو شامل — يُدفع عند تجديد البوليصة مرة بالسنة.',
        country: 'IL',
        sort_order: 10,
      },
      {
        id: randomUUID(),
        name_ar: 'طبيب أسنان',
        name_he: 'טיפול שיניים',
        name_en: 'Dentist',
        category: 'health',
        icon: '🦷',
        default_recurrence_months: 12,
        suggested_min: 500,
        suggested_max: 3000,
        country: 'IL',
        sort_order: 70,
      },
    ],
  }
}

/* ── المشاهد: محسوبة عند كل قراءة، تماماً كالأصل ────────────── */

function obligationBalances(db) {
  return db.obligations.map((o) => {
    const deposits = db.fund_deposits.filter((d) => d.obligation_id === o.id)
    const sum = (rows) => round2(rows.reduce((t, d) => t + Number(d.amount), 0))
    return {
      obligation_id: o.id,
      user_id: o.user_id,
      fund_balance: sum(deposits),
      my_fund_balance: sum(deposits.filter((d) => d.partner_id === null)),
      my_total: round2((Number(o.total_amount) * Number(o.my_share_percent)) / 100),
      last_deposit_date: deposits.map((d) => d.deposit_date).sort().at(-1) ?? null,
      deposit_count: deposits.length,
    }
  })
}

function partnerSettlements(db) {
  return db.obligation_partner_shares.map((s) => {
    const o = db.obligations.find((x) => x.id === s.obligation_id)
    const partner = db.obligation_partners.find((p) => p.id === s.partner_id)
    const deposited = round2(
      db.fund_deposits
        .filter((d) => d.obligation_id === s.obligation_id && d.partner_id === s.partner_id)
        .reduce((t, d) => t + Number(d.amount), 0),
    )
    const owed = round2((Number(o?.total_amount ?? 0) * Number(s.share_percent)) / 100)
    return {
      obligation_id: s.obligation_id,
      user_id: s.user_id,
      partner_id: s.partner_id,
      partner_name: partner?.name ?? '',
      share_percent: Number(s.share_percent),
      owed,
      deposited,
      outstanding: round2(owed - deposited),
    }
  })
}

function billAverages(db) {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - 12)
  const cutoffKey = today(cutoff)

  return db.fixed_commitments
    .filter((c) => c.is_active)
    .map((c) => {
      const bills = db.bill_payments.filter((b) => b.commitment_id === c.id)
      const recent = bills.filter((b) => b.billing_month >= cutoffKey)
      const average =
        recent.length === 0
          ? 0
          : round2(recent.reduce((t, b) => t + Number(b.amount), 0) / recent.length)
      return {
        commitment_id: c.id,
        user_id: c.user_id,
        name: c.name,
        budgeted_amount: Number(c.amount),
        paid_count: bills.filter((b) => b.paid_at !== null).length,
        average_amount: average,
      }
    })
}

/**
 * تفاصيل البنود الشهرية.
 *
 * اللوحة الموحّدة تقرأ الحمل من هنا لا من `fixed_commitments`: هذا يحمل حصّتي
 * بالشيكل ويعرف أيَّ بندٍ انتهى قسطه، وذاك يعطي المبلغ الكامل لكل بندٍ حيّاً
 * كان أو ميتاً.
 *
 * وهو نظير العرض الحقيقي حرفاً بحرف — بما في ذلك أسماء أعمدته. العرض في
 * القاعدة يسمّي المفتاح `commitment_id` لا `id`، ويحسب `my_amount` و
 * `payments_left`. نسخةٌ هنا تكتفي بنشر الصف كما هو تجعل كل قارئٍ لتلك
 * الأعمدة يقرأ `undefined` ويمرّ الفحص بأصفارٍ تبدو نجاحاً — وهي بالضبط
 * عائلة الأخطاء التي بُنيت لأجلها scripts/lib/checks.mjs.
 */
function commitmentDetails(db) {
  const now = new Date()
  return db.fixed_commitments
    .filter((c) => c.is_active)
    .map((c) => {
      const shares = db.commitment_partner_shares.filter((s) => s.commitment_id === c.id)
      const partnersPercent = shares.reduce((t, s) => t + Number(s.share_percent), 0)
      const mySharePercent = Number(c.my_share_percent ?? 100 - partnersPercent) || 100

      // شهر أول دفعة: البند الذي لم يبدأ يظهر ولا يُحمَّل، كما في العرض الحقيقي.
      const startsOn = c.starts_on ?? null
      const startMonth = startsOn ? new Date(`${startsOn.slice(0, 7)}-01T00:00:00`) : null
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const hasStarted = startMonth === null || startMonth <= thisMonth

      // العدّ يشمل شهر الانتهاء نفسه، ويبدأ من الأكبر بين شهر أول دفعة
      // وهذا الشهر — كما في العرض الحقيقي.
      let paymentsLeft = null
      if (c.ends_on) {
        const end = new Date(`${c.ends_on}T00:00:00`)
        const from = startMonth && startMonth > thisMonth ? startMonth : thisMonth
        const months =
          (end.getFullYear() - from.getFullYear()) * 12 + (end.getMonth() - from.getMonth()) + 1
        paymentsLeft = Math.max(0, months)
      }

      return {
        ...c,
        commitment_id: c.id,
        annual_interest_percent: Number(c.annual_interest_percent ?? 0),
        my_share_percent: mySharePercent,
        my_amount: round2((Number(c.amount) * mySharePercent) / 100),
        payments_left: paymentsLeft,
        starts_on: startsOn,
        has_started: hasStarted,
        partner_count: shares.length,
      }
    })
}

const VIEWS = {
  obligation_balances: obligationBalances,
  partner_settlements: partnerSettlements,
  bill_averages: billAverages,
  commitment_details: commitmentDetails,
}

/* ── ترجمة استعلام PostgREST ────────────────────────────────── */

/** `col=eq.value` → مرشّح. غير المدعوم يُرمى صراحةً لا يُتجاهَل. */
function applyFilters(rows, params) {
  let result = rows

  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue

    /*
     * ‏`is` و`in` ليسا زينة.
     *
     * ‏`archived_at is null` لا يُكتب `eq.null`: في Postgres `= NULL` لا يطابق
     * شيئاً أبداً، فالمرشّح الخطأ يردّ قائمةً فارغة بدل الحسابات كلها — ويمرّ
     * صامتاً. و`in` يستعمله إغلاق التسويات بنداءٍ واحد.
     */
    const match = /^(eq|gte|lte|gt|lt|neq|is|in)\.(.*)$/s.exec(raw)
    if (!match) throw new Error(`مرشّح غير مدعوم في الفحص: ${key}=${raw}`)

    const [, op, value] = match

    if (op === 'in') {
      const wanted = new Set(
        value
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((v) => v.replace(/^"|"$/g, '')),
      )
      result = result.filter((row) => wanted.has(String(row[key])))
      continue
    }
    const parse = (v) => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v)
    const target = parse(value)

    result = result.filter((row) => {
      const actual = row[key]
      // PostgREST يقارن نصّياً على القيم القادمة من الرابط، فنسوّي النوع قبل المقارنة.
      const a = actual === null || actual === undefined ? null : actual
      const b = target
      switch (op) {
        // ‏`is` تقارن بالهوية لا بالنصّ: null هي null وليست السلسلة "null".
        case 'is':
          return b === null ? a === null : a === b
        case 'eq':
          return typeof b === 'boolean' ? Boolean(a) === b : String(a) === String(b)
        case 'neq':
          return String(a) !== String(b)
        case 'gte':
          return String(a) >= String(b)
        case 'lte':
          return String(a) <= String(b)
        case 'gt':
          return String(a) > String(b)
        case 'lt':
          return String(a) < String(b)
        default:
          return true
      }
    })
  }

  return result
}

function applyOrderAndLimit(rows, params) {
  const order = params.get('order')
  let result = [...rows]

  if (order) {
    for (const clause of order.split(',').reverse()) {
      const [column, direction = 'asc'] = clause.split('.')
      result.sort((a, b) => {
        const x = a[column]
        const y = b[column]
        if (x === y) return 0
        if (x === null || x === undefined) return 1
        if (y === null || y === undefined) return -1
        return (x < y ? -1 : 1) * (direction.startsWith('desc') ? -1 : 1)
      })
    }
  }

  const limit = params.get('limit')
  if (limit) result = result.slice(0, Number(limit))
  return result
}

/* ── الخادم ─────────────────────────────────────────────────── */

export async function startFakeSupabase() {
  const db = seed()
  const calls = []

  /*
   * حقن عطل لمرة واحدة.
   *
   * أخطاء القاعدة الحقيقية — رفض RLS، خرق قيد، جلسة منتهية — لا يمكن استدراجها
   * من قاعدة سليمة، وهي بالضبط المسار الذي انكسر مرة: supabase-js يعيد كائناً
   * عادياً لا صنف Error في `{ data, error }`، فكان كل خطأ من القاعدة يصل
   * المستخدم «[object Object]». بلا هذا الحقن يبقى ذلك المسار بلا فحص.
   */
  let nextFailure = null

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const body = await readBody(req)
    calls.push(`${req.method} ${url.pathname}${url.search}`)

    /*
     * ترويسات CORS: القاعدة المزيّفة تُستدعى من المتصفّح أيضاً.
     *
     * كانت تُنادى من Node وحده (فحص خادم MCP)، فلم تحتج إليها. ومع تشغيل
     * الواجهة عليها لفحص الشاشات — تسجيل دخولٍ حقيقي وبياناتٍ مزروعة بلا حساب
     * ولا شبكة — يردّ المتصفّح كلَّ نداءٍ بلا هذه الترويسات، فتبدو الشاشة
     * معطّلة لسببٍ لا علاقة له بها.
     */
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range',
    }

    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json', ...cors })
      res.end(JSON.stringify(payload))
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      return res.end()
    }

    if (nextFailure && url.pathname.startsWith('/rest/v1/')) {
      const { status, ...payload } = nextFailure
      nextFailure = null
      return send(status ?? 400, payload)
    }

    try {
      /* الدالّة تتحقّق من الجلسة القادمة من صفحة الدخول عبر هذا المسار. */
      if (url.pathname === '/auth/v1/user') {
        const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
        let sub = null
        try {
          sub = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub
        } catch {
          sub = null
        }
        const account = ACCOUNTS.find((a) => a.id === sub)
        if (!account) return send(401, { message: 'invalid claim: missing sub claim' })
        return send(200, {
          id: account.id,
          email: account.email,
          aud: 'authenticated',
          role: 'authenticated',
        })
      }

      if (url.pathname === '/auth/v1/token') {
        const grant = url.searchParams.get('grant_type')
        const expiresAt = Math.floor(Date.now() / 1000) + 3600

        const sessionFor = (account) => ({
          access_token: makeJwt(account.id, expiresAt),
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: expiresAt,
          // رمز تجديد يحمل صاحبه: يكفي لمحاكاة عائلةِ جلسةٍ مستقلة لكل دخول.
          refresh_token: `refresh.${account.id}.${randomUUID()}`,
          user: { id: account.id, email: account.email, aud: 'authenticated', role: 'authenticated' },
        })

        if (grant === 'refresh_token') {
          const owner = String(body?.refresh_token ?? '').split('.')[1]
          const account = ACCOUNTS.find((a) => a.id === owner)
          if (!account) {
            return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' })
          }
          return send(200, sessionFor(account))
        }

        const account = ACCOUNTS.find(
          (a) => a.email === body?.email && a.password === body?.password,
        )
        if (!account) {
          return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
        }
        return send(200, sessionFor(account))
      }

      if (!url.pathname.startsWith('/rest/v1/')) return send(404, { message: 'not found' })

      const table = url.pathname.slice('/rest/v1/'.length)

      /*
       * محاكاة RLS.
       *
       * بدونها يكون فحصُ العزل مسرحيةً: خادمٌ يخلط بيانات المستخدمين سيمرّ
       * لأن القاعدة المزيّفة تعطي الجميع كلَّ شيء. هنا نستخرج صاحبَ الرمز من
       * الترويسة ونحصر كل صفٍّ على `user_id` تبعه — كما تفعل السياسات فعلاً.
       */
      const jwt = (req.headers.authorization ?? '').replace(/^Bearer /i, '')
      const caller =
        jwt && jwt !== ANON_KEY
          ? (() => {
              try {
                return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).sub
              } catch {
                return null
              }
            })()
          : null

      /*
       * `user_id` فارغاً يعني صفَّ نظامٍ يراه الجميع — التصنيفات وطرق الدفع
       * والقوالب. حصرُه على المستخدم كان يُخفيها كلها، وعليها تعتمد الشاشات.
       */
      const scoped = (rows) =>
        table === 'obligation_templates' || !caller
          ? rows
          : rows.filter((r) => r.user_id === undefined || r.user_id === null || r.user_id === caller)
      const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json')

      const respond = (rows) => {
        if (!wantsObject) return send(200, rows)
        if (rows.length !== 1) {
          return send(406, {
            code: 'PGRST116',
            message: `JSON object requested, multiple (or no) rows returned`,
          })
        }
        return send(200, rows[0])
      }

      if (req.method === 'GET') {
        const source = VIEWS[table] ? VIEWS[table](db) : db[table]
        if (!source) return send(404, { message: `جدول غير معروف في الفحص: ${table}` })
        return respond(
          applyOrderAndLimit(applyFilters(scoped(source), url.searchParams), url.searchParams),
        )
      }

      if (req.method === 'POST') {
        const rows = db[table]
        if (!rows) return send(404, { message: `جدول غير معروف في الفحص: ${table}` })

        const incoming = Array.isArray(body) ? body : [body]
        const prefer = req.headers.prefer ?? ''
        const conflict = url.searchParams.get('on_conflict')?.split(',') ?? []
        const inserted = []

        for (const row of incoming) {
          if (prefer.includes('merge-duplicates') && conflict.length > 0) {
            const existing = rows.find((r) => conflict.every((c) => r[c] === row[c]))
            if (existing) {
              Object.assign(existing, row)
              inserted.push(existing)
              continue
            }
          }
          const created = {
            id: randomUUID(),
            created_at: new Date().toISOString(),
            ...defaultsFor(table),
            ...row,
          }
          rows.push(created)
          inserted.push(created)
        }

        return respond(inserted)
      }

      if (req.method === 'PATCH') {
        const rows = db[table]
        if (!rows) return send(404, { message: `جدول غير معروف في الفحص: ${table}` })
        const targets = applyFilters(scoped(rows), url.searchParams)
        for (const row of targets) {
          /*
           * مُشغِّل `accounts_touch_balance` يُحاكى هنا.
           *
           * القاعدة تضبط `balance_updated_at` عند كل تغيير رصيد، والخادم يعتمد
           * على ذلك ولا يضبطه بنفسه. فقاعدةٌ مزيّفة بلا المُشغِّل تجعل فحص
           * «الرصيد صار قديماً» يقيس تاريخ الإنشاء لا تاريخ الرصيد.
           */
          if (table === 'accounts' && body?.balance !== undefined && body.balance !== row.balance) {
            row.balance_updated_at = new Date().toISOString()
          }
          Object.assign(row, body)
        }
        return respond(targets)
      }

      /* الحذف: يستعمله ضبط الشركاء — استبدالٌ كامل لحصص التزام. */
      if (req.method === 'DELETE') {
        const rows = db[table]
        if (!rows) return send(404, { message: `جدول غير معروف في الفحص: ${table}` })

        const doomed = new Set(applyFilters(scoped(rows), url.searchParams))
        db[table] = rows.filter((row) => !doomed.has(row))
        return respond([...doomed])
      }

      return send(405, { message: `طريقة غير مدعومة في الفحص: ${req.method}` })
    } catch (error) {
      return send(400, { message: error.message })
    }
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    anonKey: ANON_KEY,
    email: EMAIL,
    password: PASSWORD,
    userId: USER_ID,
    other: { email: OTHER_EMAIL, password: OTHER_PASSWORD, userId: OTHER_USER_ID },
    db,
    calls,
    /** يجعل نداء REST القادم يفشل بخطأ على شكل PostgREST تماماً. */
    failNext: (failure) => {
      nextFailure = failure
    },
    stop: () => new Promise((resolve) => server.close(resolve)),
  }
}

/** ما تملؤه القاعدة تلقائياً حين لا يمرّره العميل. */
function defaultsFor(table) {
  switch (table) {
    case 'obligations':
      return {
        is_active: true,
        notes: null,
        category: null,
        group_id: null,
        account_id: null,
        recurrence_months: 12,
      }
    case 'fund_deposits':
      return { partner_id: null, note: null, account_id: null, deposit_date: today() }
    case 'obligation_payments':
      return { paid_from_account_id: null }
    case 'expenses':
      return { group_id: null, category: null, account_id: null, note: null, spent_at: today() }
    case 'bill_payments':
      return { paid_at: null, note: null }
    case 'income_sources':
      return { is_active: true, is_variable: false }
    case 'fixed_commitments':
      return {
        is_active: true,
        day_of_month: null,
        starts_on: null,
        ends_on: null,
        total_amount: null,
        my_share_percent: 100,
        icon: null,
        default_method_id: null,
        account_id: null,
      }
    case 'income_entries':
      return { note: null, source_id: null, received_at: today() }
    case 'accounts':
      return {
        kind: 'checking',
        balance: 0,
        balance_updated_at: new Date().toISOString(),
        archived_at: null,
      }
    case 'account_transfers':
      return { note: null, transferred_at: today() }
    case 'account_settlements':
      return { note: null, obligation_id: null, settled_at: null, settled_by_transfer_id: null }
    default:
      return {}
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(null)
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
  })
}
