/**
 * مركز الشركاء: كل شريكٍ وما عليه وما يحمله — عبر الالتزامات والفواتير معاً.
 * ملف نقي — لا React ولا Supabase.
 *
 * الجواب كان مبعثراً: تسوية الالتزام في صفحة تفاصيله، وحصّة الفاتورة خلف
 * زرٍّ مطويّ في بطاقتها، ولا مكان يجمع «قديش باقي عند سامر من كل شي». من
 * له شريكٌ واحد في ثلاثة أشياء كان يفتح ثلاث صفحات ويجمع بالآلة الحاسبة.
 */

export interface PartnerRef {
  id: string
  name: string
}

/** سطر تسوية التزامٍ واحد لشريكٍ واحد — كما يخرجه عرض `partner_settlements`. */
export interface PartnerObligationShare {
  partnerId: string
  obligationId: string
  /** `null` = التزامٌ لم يعد نشطاً — يُسمّى في الواجهة لا هنا. */
  obligationName: string | null
  owed: number
  deposited: number
}

/** حصّة شريكٍ في فاتورةٍ شهرية جارية. */
export interface PartnerCommitmentShare {
  partnerId: string
  commitmentId: string
  commitmentName: string
  /** حصّة الشريك بالشيكل من فاتورة الشهر. */
  monthlyAmount: number
}

export interface PartnerObligationRow {
  obligationId: string
  name: string | null
  owed: number
  deposited: number
  outstanding: number
}

export interface PartnerSummary {
  id: string
  name: string
  obligations: PartnerObligationRow[]
  commitments: { commitmentId: string; name: string; monthlyAmount: number }[]
  owedTotal: number
  depositedTotal: number
  /**
   * مجموع الباقي، مقصوصاً عند الصفر **لكل التزامٍ على حدة**: زيادةٌ أودعها
   * الشريك في صندوق التأمين لا تسدّ نقصَه في صندوق الترخيص — المال محجوزٌ
   * في صندوقه، والمقاصّة بينهما قرارُ صاحبها لا حسبةٌ تقع خلسة.
   */
  outstanding: number
  /** ما يحمله الشريك من الفواتير الجارية شهرياً. */
  monthlyTotal: number
  /** له حصصٌ وكلها مسدَّدة — تستحق أن تُقال، لا أن تُترك فراغاً. */
  isSettled: boolean
}

const round2 = (v: number): number => Math.round(v * 100) / 100

export function summarizePartners(
  partners: readonly PartnerRef[],
  obligationShares: readonly PartnerObligationShare[],
  commitmentShares: readonly PartnerCommitmentShare[],
): PartnerSummary[] {
  const summaries = partners.map((partner) => {
    const obligations = obligationShares
      .filter((s) => s.partnerId === partner.id)
      .map((s) => ({
        obligationId: s.obligationId,
        name: s.obligationName,
        owed: round2(s.owed),
        deposited: round2(s.deposited),
        outstanding: Math.max(0, round2(s.owed - s.deposited)),
      }))
      .sort((a, b) => b.outstanding - a.outstanding)

    const commitments = commitmentShares
      .filter((s) => s.partnerId === partner.id)
      .map((s) => ({
        commitmentId: s.commitmentId,
        name: s.commitmentName,
        monthlyAmount: round2(s.monthlyAmount),
      }))
      .sort((a, b) => b.monthlyAmount - a.monthlyAmount)

    const owedTotal = round2(obligations.reduce((sum, o) => sum + o.owed, 0))
    const depositedTotal = round2(obligations.reduce((sum, o) => sum + o.deposited, 0))
    const outstanding = round2(obligations.reduce((sum, o) => sum + o.outstanding, 0))
    const monthlyTotal = round2(commitments.reduce((sum, c) => sum + c.monthlyAmount, 0))

    return {
      id: partner.id,
      name: partner.name,
      obligations,
      commitments,
      owedTotal,
      depositedTotal,
      outstanding,
      monthlyTotal,
      isSettled: (obligations.length > 0 || commitments.length > 0) && outstanding === 0,
    }
  })

  /*
   * المديون أولاً — هو سبب فتح الشاشة. ثم من يحمل شهرياً، ثم البقية بالاسم.
   * والترتيب ثابتٌ عند التساوي: قائمةٌ تعيد ترتيب نفسها تجعل الإصبع يخطئ.
   */
  return summaries.sort(
    (a, b) =>
      b.outstanding - a.outstanding ||
      b.monthlyTotal - a.monthlyTotal ||
      a.name.localeCompare(b.name, 'ar'),
  )
}

/** مجموع الباقي عند الشركاء كلهم — رقم رأس الشاشة. */
export function totalOutstanding(summaries: readonly PartnerSummary[]): number {
  return round2(summaries.reduce((sum, s) => sum + s.outstanding, 0))
}
