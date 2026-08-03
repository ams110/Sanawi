/**
 * Supabase مزيّف في الذاكرة — لفحص خادم MCP بلا حساب حقيقي.
 *
 * لماذا لا نفحص على القاعدة الحقيقية؟ نفعل، حين تتوفّر (`npm run check:mcp`
 * يلتقط بيانات .env). لكن فحصاً يشترط حساباً وشبكةً لا يُشغَّل في CI ولا على
 * جهاز مساهم جديد، فيبقى الخادم بلا شبكة أمان في أكثر الأوقات حاجةً إليها.
 * هذا الملف يجعل الفحص الكامل — سبع عشرة أداة، قراءةً وكتابةً — يعمل في أي
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

const VIEWS = {
  obligation_balances: obligationBalances,
  partner_settlements: partnerSettlements,
  bill_averages: billAverages,
}

/* ── ترجمة استعلام PostgREST ────────────────────────────────── */

/** `col=eq.value` → مرشّح. غير المدعوم يُرمى صراحةً لا يُتجاهَل. */
function applyFilters(rows, params) {
  let result = rows

  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue

    const match = /^(eq|gte|lte|gt|lt|neq)\.(.*)$/s.exec(raw)
    if (!match) throw new Error(`مرشّح غير مدعوم في الفحص: ${key}=${raw}`)

    const [, op, value] = match
    const parse = (v) => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v)
    const target = parse(value)

    result = result.filter((row) => {
      const actual = row[key]
      // PostgREST يقارن نصّياً على القيم القادمة من الرابط، فنسوّي النوع قبل المقارنة.
      const a = actual === null || actual === undefined ? null : actual
      const b = target
      switch (op) {
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

    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    if (nextFailure && url.pathname.startsWith('/rest/v1/')) {
      const { status, ...payload } = nextFailure
      nextFailure = null
      return send(status ?? 400, payload)
    }

    try {
      if (url.pathname === '/auth/v1/token') {
        if (body?.email !== EMAIL || body?.password !== PASSWORD) {
          return send(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
        }
        return send(200, {
          access_token: 'fake-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          refresh_token: 'fake-refresh-token',
          user: { id: USER_ID, email: EMAIL, aud: 'authenticated', role: 'authenticated' },
        })
      }

      if (!url.pathname.startsWith('/rest/v1/')) return send(404, { message: 'not found' })

      const table = url.pathname.slice('/rest/v1/'.length)
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
        return respond(applyOrderAndLimit(applyFilters(source, url.searchParams), url.searchParams))
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
        const targets = applyFilters(rows, url.searchParams)
        for (const row of targets) Object.assign(row, body)
        return respond(targets)
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
      return { is_active: true, notes: null, category: null, group_id: null, recurrence_months: 12 }
    case 'fund_deposits':
      return { partner_id: null, note: null, deposit_date: today() }
    case 'expenses':
      return { group_id: null, category: null, note: null, spent_at: today() }
    case 'bill_payments':
      return { paid_at: null, note: null }
    case 'income_sources':
    case 'fixed_commitments':
      return { is_active: true, day_of_month: null }
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
