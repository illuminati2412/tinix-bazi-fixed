/**
 * BaZi Calculator - Core calculation module
 * Converted from Python bazi/calculator.py
 *
 * FIX: Dùng đúng lịch tiết khí (節氣曆) cho tứ trụ.
 *
 * lunar-javascript tính năm trụ và tháng trụ đúng theo tiết khí,
 * nhưng BẮT BUỘC phải truyền đủ giờ phút vào Solar.fromYmdHms().
 * Nếu chỉ dùng Solar.fromYmd() thì mặc định 0h → sai với người sinh
 * đúng ngày tiết khí nhưng sau giờ tiết bắt đầu.
 *
 * Các bug đã sửa:
 *  1. Khi isSolar=false: dùng Lunar.fromYmdHms thay vì Lunar.fromYmd
 *     để giữ nguyên giờ sinh trước khi chuyển sang Solar.
 *  2. Lấy tiết khí hiện hành (currentJieQi) từ bảng tiết khí năm,
 *     thay vì dùng lunar.getJieQi() chỉ trả về giá trị khi đúng ngày tiết.
 *  3. zhiShen3 trong _buildContext: nhất quán dùng Chinese can khi gọi getThapThan.
 */

const { Solar, Lunar } = require('lunar-javascript');
const ganzhi = require('./ganzhi');
const core = require('./core');

class BaZiCalculator {
    constructor(options) {
        this.year = options.year;
        this.month = options.month;
        this.day = options.day;
        this.hour = options.hour || 12;
        this.minute = options.minute || 0;
        this.isFemale = options.isFemale || false;
        this.isSolar = options.isSolar !== false; // default true

        this.gans = [];  // Thiên Can
        this.zhis = [];  // Địa Chi
        this.pillars = [];
        this.elements = {};
        this.scores = {};
    }

    /**
     * Calculate BaZi chart
     */
    calculate() {
        // FIX 1: Luôn giữ giờ phút khi chuyển đổi âm/dương lịch.
        // lunar-javascript dùng giờ để xác định đúng tiết khí (năm trụ và tháng trụ
        // đổi đúng giờ tiết bắt đầu, không phải đổi vào 0h của ngày đó).
        let solar;
        if (this.isSolar) {
            solar = Solar.fromYmdHms(this.year, this.month, this.day, this.hour, this.minute, 0);
        } else {
            // Lunar.fromYmdHms giữ nguyên giờ sinh → getSolar() trả về Solar đúng giờ
            const lunarInput = Lunar.fromYmdHms(this.year, this.month, this.day, this.hour, this.minute, 0);
            solar = lunarInput.getSolar();
        }

        // Lấy lunar object từ Solar có đủ giờ để getEightChar() dùng tiết khí đúng
        const lunar = solar.getLunar();
        const bazi = lunar.getEightChar();

        // Get Gans (Heavenly Stems) — thư viện trả về Chinese chars
        this.gans = [
            bazi.getYearGan(),
            bazi.getMonthGan(),
            bazi.getDayGan(),
            bazi.getTimeGan()
        ];

        // Get Zhis (Earthly Branches) — thư viện trả về Chinese chars
        this.zhis = [
            bazi.getYearZhi(),
            bazi.getMonthZhi(),
            bazi.getDayZhi(),
            bazi.getTimeZhi()
        ];

        // Build pillars
        this.pillars = this._buildPillars();

        // Calculate elements
        this.elements = this._calculateElements();

        // Calculate scores
        this.scores = this._calculateScores();

        // Build context
        return this._buildContext(solar, lunar, bazi);
    }

    /**
     * Build four pillars with details
     */
    _buildPillars() {
        const pillarNames = ['Năm', 'Tháng', 'Ngày', 'Giờ'];
        const pillars = [];

        for (let i = 0; i < 4; i++) {
            const gan = this.gans[i];   // Chinese char, e.g. '甲'
            const zhi = this.zhis[i];   // Chinese char, e.g. '寅'
            const ganVN = ganzhi.ganToVN(gan);
            const zhiVN = ganzhi.zhiToVN(zhi);

            // Build tang_can with calculated thap_than
            // TANG_CAN keys là Chinese zhi, values can là Vietnamese names
            const rawTangCan = ganzhi.getTangCan(zhi);
            const tangCanWithThapThan = rawTangCan.map(tc => {
                // tc.can là Vietnamese (e.g. 'Giáp') → convert về Chinese để gọi getThapThan nhất quán
                const canVN = tc.can;
                const canCN = ganzhi.GANS[ganzhi.GANS_VN.indexOf(canVN)] || '';
                return {
                    can: canVN,
                    thap_than: ganzhi.getThapThan(this.gans[2], canCN)
                };
            });

            pillars.push({
                tru: pillarNames[i],
                can: ganVN,
                chi: zhiVN,
                can_cn: gan,
                chi_cn: zhi,
                nap_am: ganzhi.getNapAm(gan, zhi),
                tang_can: tangCanWithThapThan,
                thap_than_can: i === 2 ? 'Nhật Chủ' : ganzhi.getThapThan(this.gans[2], gan),
                thap_than_chi: ganzhi.getThapThan(this.gans[2], ganzhi.getZhiMainGan(zhi))
            });
        }

        return pillars;
    }

    /**
     * Calculate five elements distribution - EXACT MATCH WITH PYTHON
     * Python: for item in ctx.gans: ctx.scores[gan5[item]] += 5
     *         for item in list(ctx.zhis) + [ctx.zhis.month]: ... += zhi5[item][gan]
     */
    _calculateElements() {
        const elements = { Kim: 0, Mộc: 0, Thủy: 0, Hỏa: 0, Thổ: 0 };

        // Count from all Gans - each Gan adds 5 points to its element
        for (const gan of this.gans) {
            const element = ganzhi.GAN5[gan] || ganzhi.ganToElement(gan);
            if (elements[element] !== undefined) {
                elements[element] += 5;
            }
        }

        // Count from all Zhis using hidden stems with weights
        // IMPORTANT: Month zhi is counted TWICE in Python (list(ctx.zhis) + [ctx.zhis.month])
        const zhisWithExtraMonth = [...this.zhis, this.zhis[1]]; // Add month again

        for (const zhi of zhisWithExtraMonth) {
            const hiddenStems = ganzhi.ZHI5[zhi];
            if (hiddenStems) {
                for (const [hiddenGan, weight] of Object.entries(hiddenStems)) {
                    const element = ganzhi.GAN5[hiddenGan];
                    if (element && elements[element] !== undefined) {
                        elements[element] += weight;
                    }
                }
            }
        }

        return elements;
    }

    /**
     * Calculate strength scores - EXACT MATCH WITH PYTHON
     * Python: ctx.strong = gan_scores[Tỷ] + gan_scores[Kiếp] + gan_scores[Kiêu] + gan_scores[Ấn]
     */
    _calculateScores() {
        const dayGan = this.gans[2];

        // Calculate gan_scores (score per individual Gan)
        const ganScores = {};
        for (const gan of ganzhi.GANS) {
            ganScores[gan] = 0;
        }

        // Add 5 for each Gan in chart
        for (const gan of this.gans) {
            ganScores[gan] = (ganScores[gan] || 0) + 5;
        }

        // Add weights for hidden stems (including month counted twice)
        const zhisWithExtraMonth = [...this.zhis, this.zhis[1]];
        for (const zhi of zhisWithExtraMonth) {
            const hiddenStems = ganzhi.ZHI5[zhi];
            if (hiddenStems) {
                for (const [hiddenGan, weight] of Object.entries(hiddenStems)) {
                    ganScores[hiddenGan] = (ganScores[hiddenGan] || 0) + weight;
                }
            }
        }

        // Calculate strong score = Tỷ + Kiếp + Kiêu + Ấn
        let strongScore = 0;
        for (const gan of ganzhi.GANS) {
            const thapThan = ganzhi.getThapThan(dayGan, gan);
            if (['Tỷ', 'Kiếp', 'Kiêu', 'Ấn'].includes(thapThan)) {
                strongScore += ganScores[gan] || 0;
            }
        }

        // Calculate total score
        const totalScore = Object.values(this.elements).reduce((sum, v) => sum + v, 0);

        // Determine weak/strong - Use Vong Trang Sinh (12 Life Stages)
        let isWeak = true;
        const meStatus = [];

        for (const zhi of this.zhis) {
            const status = ganzhi.getVongTrangSinh(dayGan, zhi);
            meStatus.push(status);
            if (['Tr.Sinh', 'Đ.Vượng', 'L.Quan'].includes(status)) {
                isWeak = false;
            }
        }

        // Additional check: if still weak, check if Tỷ count + Mộ count > 2
        if (isWeak) {
            const ganShens = this.gans.map((g, i) => i === 2 ? '' : ganzhi.getThapThan(dayGan, g));
            const zhiMainShens = this.zhis.map(z => ganzhi.getThapThan(dayGan, ganzhi.getZhiMainGan(z)));
            const allShens = [...ganShens, ...zhiMainShens];

            const tyCount = allShens.filter(s => s === 'Tỷ').length;
            const moCount = meStatus.filter(s => s === 'Mộ').length;

            if (tyCount + moCount > 2) {
                isWeak = false;
            }
        }

        return {
            suc_manh: {
                diem_manh: strongScore,
                tong_diem: totalScore,
                la_nhuoc: isWeak
            },
            ngu_hanh_vn: this.elements,
            nhiet_do: this._calculateTemperature()
        };
    }

    /**
     * Calculate temperature (hot/cold balance)
     */
    _calculateTemperature() {
        let temp = 0;
        temp += (this.elements['Hỏa'] || 0) * 1;
        temp += (this.elements['Mộc'] || 0) * 0.5;
        temp -= (this.elements['Thủy'] || 0) * 1;
        temp -= (this.elements['Kim'] || 0) * 0.5;
        return Math.round(temp * 10) / 10;
    }

    /**
     * FIX 2: Lấy tiết khí đang áp dụng cho ngày sinh (tiết hiện hành),
     * không dùng lunar.getJieQi() vì nó chỉ có giá trị khi đúng ngày tiết.
     *
     * Tra bảng JieQiTable của năm, tìm tiết gần nhất đã qua tính đến
     * giờ sinh → đây là tiết đang áp dụng (tiết tháng trụ đang dùng).
     *
     * @param {Solar} solar - Solar object có đủ giờ phút
     * @returns {string} Tên tiết khí hiện hành (Vietnamese)
     */
    _getCurrentJieQi(solar) {
        // Map Chinese jieqi names → Vietnamese (chỉ 12 tiết dùng cho tháng trụ)
        const JIEQI_VN = {
            '立春': 'Lập Xuân',   '惊蛰': 'Kinh Trập',  '清明': 'Thanh Minh',
            '立夏': 'Lập Hạ',     '芒种': 'Mang Chủng',  '小暑': 'Tiểu Thử',
            '立秋': 'Lập Thu',    '白露': 'Bạch Lộ',     '寒露': 'Hàn Lộ',
            '立冬': 'Lập Đông',   '大雪': 'Đại Tuyết',   '小寒': 'Tiểu Hàn',
            // 12 trung khí (cần để hiển thị đầy đủ)
            '雨水': 'Vũ Thủy',    '春分': 'Xuân Phân',   '谷雨': 'Cốc Vũ',
            '小满': 'Tiểu Mãn',   '夏至': 'Hạ Chí',      '大暑': 'Đại Thử',
            '处暑': 'Xử Thử',     '秋分': 'Thu Phân',    '霜降': 'Sương Giáng',
            '小雪': 'Tiểu Tuyết', '冬至': 'Đông Chí',    '大寒': 'Đại Hàn',
        };
        // Các key dạng SNAKE_CASE trong lunar-javascript (một số tiết dùng cả hai cách)
        const JIEQI_SNAKE_VN = {
            'LI_CHUN': 'Lập Xuân',  'JING_ZHE': 'Kinh Trập', 'QING_MING': 'Thanh Minh',
            'LI_XIA': 'Lập Hạ',    'MANG_ZHONG': 'Mang Chủng','XIAO_SHU': 'Tiểu Thử',
            'LI_QIU': 'Lập Thu',   'BAI_LU': 'Bạch Lộ',      'HAN_LU': 'Hàn Lộ',
            'LI_DONG': 'Lập Đông', 'DA_XUE': 'Đại Tuyết',    'XIAO_HAN': 'Tiểu Hàn',
            'YU_SHUI': 'Vũ Thủy',  'CHUN_FEN': 'Xuân Phân',  'GU_YU': 'Cốc Vũ',
            'XIAO_MAN': 'Tiểu Mãn','XIA_ZHI': 'Hạ Chí',      'DA_SHU': 'Đại Thử',
            'CHU_SHU': 'Xử Thử',   'QIU_FEN': 'Thu Phân',    'SHUANG_JIANG': 'Sương Giáng',
            'XIAO_XUE': 'Tiểu Tuyết','DONG_ZHI': 'Đông Chí', 'DA_HAN': 'Đại Hàn',
        };

        try {
            const tbl = solar.getLunar().getJieQiTable();
            if (!tbl) return '';

            // Giờ sinh tính bằng milliseconds (UTC-agnostic, chỉ cần so sánh tương đối)
            const birthMs = Date.UTC(solar.getYear(), solar.getMonth() - 1, solar.getDay(),
                                     solar.getHour(), solar.getMinute(), solar.getSecond());

            let latestJieQiVN = '';
            let latestMs = -Infinity;

            for (const [key, val] of Object.entries(tbl)) {
                // val._p = { year, month, day, hour, minute, second }
                const p = val._p || val;
                if (!p || p.year === undefined) continue;

                const jieQiMs = Date.UTC(p.year, p.month - 1, p.day, p.hour || 0, p.minute || 0, p.second || 0);

                // Tìm tiết gần nhất đã qua (≤ giờ sinh)
                if (jieQiMs <= birthMs && jieQiMs > latestMs) {
                    latestMs = jieQiMs;
                    latestJieQiVN = JIEQI_VN[key] || JIEQI_SNAKE_VN[key] || key;
                }
            }

            return latestJieQiVN;
        } catch (e) {
            return '';
        }
    }

    /**
     * Build full context object
     */
    _buildContext(solar, lunar, bazi) {
        const dayGan = this.gans[2];
        const dayGanVN = ganzhi.ganToVN(dayGan);
        const monthZhiVN = ganzhi.zhiToVN(this.zhis[1]);

        // Calculate specialized shishen lists for analyze modules
        const ganShens = this.gans.map((g, i) => i === 2 ? 'Nhật Chủ' : ganzhi.getThapThan(dayGan, g));
        const zhiShens = this.zhis.map(z => ganzhi.getThapThan(dayGan, ganzhi.getZhiMainGan(z)));

        // FIX 3: zhiShen3 - getTangCan trả về VN names, convert về Chinese trước khi getThapThan
        const zhiShen3 = this.zhis.map(z =>
            ganzhi.getTangCan(z).map(t => {
                const canCN = ganzhi.GANS[ganzhi.GANS_VN.indexOf(t.can)] || t.can;
                return ganzhi.getThapThan(dayGan, canCN);
            })
        );

        // Flattened list of all shens in the chart
        const shens2 = [...ganShens.filter(s => s !== 'Nhật Chủ'), ...zhiShen3.flat()];

        // FIX 2: Lấy tiết khí hiện hành đúng cách
        const tietKhi = this._getCurrentJieQi(solar);

        // Use lunar-javascript API for proper calculations
        let menhCung = '';
        let thaiNguyen = '';
        let thanCung = '';
        let nhapVan = '';
        let yun = null;

        // Helper to translate Chinese GanZhi to Vietnamese
        const translateGanZhi = (str) => {
            if (!str) return '';
            if (str.length === 2) {
                const gan = str[0];
                const zhi = str[1];
                return `${ganzhi.ganToVN(gan)} ${ganzhi.zhiToVN(zhi)}`;
            }
            if (str.includes(' ')) return str;
            return str;
        };

        try {
            const rawMenhCung = bazi.getMingGong ? bazi.getMingGong() : null;
            menhCung = rawMenhCung ? translateGanZhi(rawMenhCung) : `${dayGanVN} ${monthZhiVN}`;

            const rawThaiNguyen = bazi.getTaiYuan ? bazi.getTaiYuan() : null;
            thaiNguyen = rawThaiNguyen ? translateGanZhi(rawThaiNguyen) : this._getThaiNguyenManual();

            const rawThanCung = bazi.getShenGong ? bazi.getShenGong() : null;
            thanCung = rawThanCung ? translateGanZhi(rawThanCung) : `${dayGanVN} ${ganzhi.zhiToVN(this.zhis[2])}`;

            // Nhập vận
            const dayun = require('./dayun');
            const yearGan = this.gans[0];
            const yearGanIdx = ganzhi.GANS.indexOf(yearGan);
            const isYangYear = yearGanIdx >= 0 ? yearGanIdx % 2 === 0 : true;

            let isForward;
            if (this.isFemale) {
                isForward = !isYangYear;
            } else {
                isForward = isYangYear;
            }

            const startAgeObj = dayun.calculateStartAge(solar, lunar, isForward);

            let targetYear = solar.getYear() + startAgeObj.years;
            let targetMonth = solar.getMonth() + startAgeObj.months;

            while (targetMonth > 12) {
                targetMonth -= 12;
                targetYear += 1;
            }

            nhapVan = `Tháng ${targetMonth}/${targetYear}`;

        } catch (e) {
            console.error('Error calculating Nhap Van:', e);
            menhCung = `${dayGanVN} ${monthZhiVN}`;
            thaiNguyen = this._getThaiNguyenManual();
            thanCung = `${dayGanVN} ${ganzhi.zhiToVN(this.zhis[2])}`;
            nhapVan = 'Đang tính';
        }

        const isWeak = this.scores?.suc_manh?.la_nhuoc;
        const canYeu = isWeak === true ? 'Yếu' : isWeak === false ? 'Mạnh' : 'Trung bình';

        return {
            basicInfo: {
                ten: '',
                gioi_tinh: this.isFemale ? 'Nữ' : 'Nam',
                ngay_duong_lich: `Năm ${solar.getYear()} tháng ${solar.getMonth()} ngày ${solar.getDay()}`,
                ngay_am_lich: `Năm ${lunar.getYear()} tháng ${lunar.getMonth()} ngày ${lunar.getDay()}`,
                gio_sinh: String(this.hour),
                gio_chi: ganzhi.zhiToVN(this.zhis[3]),
                tiet_khi: tietKhi,   // FIX 2: tiết khí hiện hành, không phải getJieQi()
                menh_cung: menhCung,
                thai_nguyen: thaiNguyen,
                than_cung: thanCung,
                nhap_van: nhapVan,
                can_yeu: canYeu
            },
            pillars: this.pillars,
            elements: this.elements,
            elementsVN: this.elements,
            scores: this.scores,
            balance: this._getBalance(),
            gans: this.gans,
            zhis: this.zhis,
            zhus: this.gans.map((g, i) => [g, this.zhis[i]]),
            dayGan: this.gans[2],
            dayZhi: this.zhis[2],
            isFemale: this.isFemale,
            solar,
            lunar,
            bazi,
            yun,
            ganShens,
            zhiShens,
            zhiShen3,
            shens2,
            nayin: this.pillars.map(p => p.nap_am),
            ge: ganzhi.getThapThan(dayGan, ganzhi.getZhiMainGan(this.zhis[1])),
            me: dayGan,
            pillarStages: this.zhis.map(zhi => ganzhi.getVongTrangSinh(this.gans[2], zhi)),
            weak: isWeak,
            strong: this.scores?.suc_manh?.diem_manh || 0,
            hour_unknown: false
        };
    }

    _getThaiNguyenManual() {
        const monthGanIdx = ganzhi.GANS.indexOf(this.gans[1]);
        const monthZhiIdx = ganzhi.ZHIS.indexOf(this.zhis[1]);
        const thaiGanIdx = (monthGanIdx + 1) % 10;
        const thaiZhiIdx = (monthZhiIdx + 3) % 12;
        return `${ganzhi.ganToVN(ganzhi.GANS[thaiGanIdx])} ${ganzhi.zhiToVN(ganzhi.ZHIS[thaiZhiIdx])}`;
    }

    _getCanKhi() {
        const dayElement = ganzhi.ganToElement(this.gans[2]);
        const monthZhi = this.zhis[1];
        return ganzhi.getCanKhi(dayElement, monthZhi);
    }

    _getBalance() {
        const dayElement = ganzhi.ganToElement(this.gans[2]);
        return {
            day_element: dayElement,
            favorable: ganzhi.getFavorable(dayElement),
            unfavorable: ganzhi.getUnfavorable(dayElement)
        };
    }
}

module.exports = BaZiCalculator;
