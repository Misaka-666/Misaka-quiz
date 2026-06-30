package com.yiqiu.misakaquiz.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.yiqiu.misakaquiz.R
import com.yiqiu.misakaquiz.importer.model.MultiBlankSupport
import com.yiqiu.misakaquiz.importer.model.QuestionType
import com.yiqiu.misakaquiz.state.QuizRepository
import com.yiqiu.misakaquiz.state.WrongQuestionEntry
import com.yiqiu.misakaquiz.state.WrongStatus
import com.yiqiu.misakaquiz.ui.components.ActionPillButton
import com.yiqiu.misakaquiz.ui.components.EmptyStateIllustration
import com.yiqiu.misakaquiz.ui.components.GlassCard
import com.yiqiu.misakaquiz.ui.components.IllustrationHeroCard
import com.yiqiu.misakaquiz.ui.components.NoticeCard
import com.yiqiu.misakaquiz.ui.components.MisakaDangerConfirmDialog
import com.yiqiu.misakaquiz.ui.components.MisakaHeader
import com.yiqiu.misakaquiz.ui.components.StatusChip
import com.yiqiu.misakaquiz.ui.components.misakaNoRippleClickable
import com.yiqiu.misakaquiz.ui.theme.MisakaDimens
import com.yiqiu.misakaquiz.ui.theme.MisakaRadius
import com.yiqiu.misakaquiz.ui.theme.MisakaSpacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private enum class WrongBookFilter(val label: String) {
    NOT_MASTERED("未掌握"),
    MASTERED("已掌握"),
    ALL("全部")
}

private enum class WrongBookSort(val label: String) {
    RECENT_WRONG("最近错"),
    WRONG_COUNT("错误次数"),
    MASTERY("掌握程度")
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WrongBookScreen(
    onBack: () -> Unit,
    onGoPractice: () -> Unit
) {
    val context = LocalContext.current
    val wrongBook = QuizRepository.wrongBookEntriesForCurrentScope()
    val allWrongBook = QuizRepository.wrongBook.toList()
    val scopeLabel = QuizRepository.currentWrongBookScopeLabel()
    val scopeMode = QuizRepository.wrongBookScopeMode
    val activeBank = QuizRepository.activeBank()
    var filter by remember { mutableStateOf(WrongBookFilter.NOT_MASTERED) }
    var sort by remember { mutableStateOf(WrongBookSort.RECENT_WRONG) }
    var showClearWrongBookConfirm by remember { mutableStateOf(false) }
    var showScopePicker by remember { mutableStateOf(false) }
    val filteredEntries = remember(wrongBook, filter, sort) {
        wrongBook.filterBy(filter).sortBy(sort)
    }
    val reviewEntries = filteredEntries.filter { it.status != WrongStatus.MASTERED.label && !QuizRepository.isQuestionSlashed(it.bankId, it.question) }
    val notMasteredCount = wrongBook.count { it.status != WrongStatus.MASTERED.label }
    val masteredCount = wrongBook.count { it.status == WrongStatus.MASTERED.label }
    val smartReviewEnabled = QuizRepository.wrongBookSmartReviewEnabled
    val smartReviewSummary = QuizRepository.todayWrongBookSmartReviewSummary()
    val isCurrentBankScope = scopeMode == QuizRepository.WRONG_BOOK_SCOPE_CURRENT_BANK
    val isSpecificScope = isCurrentBankScope || scopeMode == QuizRepository.WRONG_BOOK_SCOPE_BANK
    val clearScopeLabel = when {
        isCurrentBankScope -> "当前题库"
        scopeMode == QuizRepository.WRONG_BOOK_SCOPE_BANK -> scopeLabel
        else -> "全部"
    }

    if (showScopePicker) {
        val scopeGroups = allWrongBook.mapNotNull { entry ->
            QuizRepository.banks.find { it.id == entry.bankId }?.groupName?.ifBlank { "未分组" }
        }.distinct().sortedWith(compareBy<String> { it == "未分组" }.thenBy { it })
        // 分组下的题库
        var expandedPickerGroups by remember { mutableStateOf(setOf<String>()) }
        AlertDialog(
            onDismissRequest = { showScopePicker = false },
            title = { Text("错题范围") },
            text = {
                Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                    if (activeBank != null) {
                        Surface(
                            modifier = Modifier.fillMaxWidth().misakaNoRippleClickable {
                                QuizRepository.setWrongBookScopeMode(context, QuizRepository.WRONG_BOOK_SCOPE_CURRENT_BANK)
                                showScopePicker = false
                            },
                            shape = RoundedCornerShape(12.dp),
                            color = if (scopeMode == QuizRepository.WRONG_BOOK_SCOPE_CURRENT_BANK) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
                        ) {
                            Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text("当前题库", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, fontWeight = if (scopeMode == QuizRepository.WRONG_BOOK_SCOPE_CURRENT_BANK) FontWeight.SemiBold else FontWeight.Normal)
                                Text(activeBank.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                    Surface(
                        modifier = Modifier.fillMaxWidth().misakaNoRippleClickable {
                            QuizRepository.setWrongBookScopeMode(context, QuizRepository.WRONG_BOOK_SCOPE_ALL_BANKS)
                            showScopePicker = false
                        },
                        shape = RoundedCornerShape(12.dp),
                        color = if (scopeMode == QuizRepository.WRONG_BOOK_SCOPE_ALL_BANKS) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
                    ) {
                        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("全部题库", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, fontWeight = if (scopeMode == QuizRepository.WRONG_BOOK_SCOPE_ALL_BANKS) FontWeight.SemiBold else FontWeight.Normal)
                            Text("${allWrongBook.size}题", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    scopeGroups.forEach { group ->
                        val banksInGroup = QuizRepository.banks.filter {
                            (it.groupName.ifBlank { "未分组" }) == group
                        }
                        val groupCount = allWrongBook.count { entry ->
                            (QuizRepository.banks.find { it.id == entry.bankId }?.groupName?.ifBlank { "未分组" }) == group
                        }
                        val isGroupSelected = scopeMode == QuizRepository.WRONG_BOOK_SCOPE_GROUP && QuizRepository.wrongBookScopeGroupName == group
                        val isExpanded = group in expandedPickerGroups
                        // Group header
                        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = if (isExpanded) Icons.Rounded.ExpandMore else Icons.Rounded.ChevronRight,
                                contentDescription = if (isExpanded) "收起" else "展开",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.misakaNoRippleClickable {
                                    expandedPickerGroups = if (isExpanded) expandedPickerGroups - group else expandedPickerGroups + group
                                }.size(28.dp).padding(4.dp)
                            )
                            Surface(
                                modifier = Modifier.weight(1f).misakaNoRippleClickable {
                                    QuizRepository.setWrongBookScopeMode(context, QuizRepository.WRONG_BOOK_SCOPE_GROUP, group)
                                    showScopePicker = false
                                },
                                shape = RoundedCornerShape(12.dp),
                                color = if (isGroupSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
                            ) {
                                Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(group, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, fontWeight = if (isGroupSelected) FontWeight.SemiBold else FontWeight.Normal)
                                    Text("${groupCount}题", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        // Bank sub-rows
                        if (isExpanded) {
                            banksInGroup.forEach { bank ->
                                val bankCount = allWrongBook.count { it.bankId == bank.id }
                                val isBankSelected = scopeMode == QuizRepository.WRONG_BOOK_SCOPE_BANK && QuizRepository.wrongBookScopeBankId == bank.id
                                Surface(
                                    modifier = Modifier.fillMaxWidth().padding(start = 28.dp).misakaNoRippleClickable {
                                        QuizRepository.setWrongBookScopeMode(context, QuizRepository.WRONG_BOOK_SCOPE_BANK, bank.id)
                                        showScopePicker = false
                                    },
                                    shape = RoundedCornerShape(12.dp),
                                    color = if (isBankSelected) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
                                ) {
                                    Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(bank.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, fontWeight = if (isBankSelected) FontWeight.SemiBold else FontWeight.Normal)
                                        Text("${bankCount}题", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showScopePicker = false }) { Text("取消") } }
        )
    }

    if (showClearWrongBookConfirm) {
        MisakaDangerConfirmDialog(
            title = if (isSpecificScope) "确认清空${clearScopeLabel}错题？" else "确认清空全部错题？",
            message = if (isSpecificScope) {
                "这会移除${clearScopeLabel}错题记录，包括错题次数、掌握状态和复习统计。其他题库错题不会受影响。"
            } else {
                "这会移除全部题库的错题记录，包括错题次数、掌握状态和复习统计。操作不可撤销。"
            },
            confirmText = if (isSpecificScope) "清空${clearScopeLabel}" else "清空全部",
            onDismiss = { showClearWrongBookConfirm = false },
            onConfirm = {
                QuizRepository.clearWrongBookForCurrentScope()
                showClearWrongBookConfirm = false
            }
        )
    }

    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = MisakaSpacing.Xl, vertical = MisakaSpacing.Sm),
        verticalArrangement = Arrangement.spacedBy(MisakaSpacing.Lg)
    ) {
        MisakaHeader(
            kicker = "Wrong Book",
            title = "错题本",
            subtitle = ""
        )

        if (wrongBook.isEmpty()) {
            EmptyStateIllustration(
                title = if (allWrongBook.isEmpty()) "错题本还是空的" else "${scopeLabel}暂无错题",
                message = when {
                    allWrongBook.isEmpty() -> "继续练习或考试后，错题会自动进入这里。"
                    isCurrentBankScope && activeBank == null -> "请先在题库管理中设为当前题库，或到设置中切换为全部题库错题。"
                    isCurrentBankScope -> "当前题库没有错题。需要查看其他错题时，可到 我的 → 错题本 中切换为全部题库。"
                    else -> "当前范围下没有错题。"
                },
                imageRes = R.drawable.illus_wrongbook_hint_webp,
                action = {
                    Spacer(Modifier.height(12.dp))
                    ActionPillButton(
                        icon = Icons.AutoMirrored.Rounded.Undo,
                        text = "返回首页",
                        primary = false,
                        onClick = onBack
                    )
                }
            )
            return
        }

        IllustrationHeroCard(
            title = "错题需要慢慢消化。",
            subtitle = "筛错题，集中复盘",
            imageRes = R.drawable.illus_wrongbook_hint_webp,
            modifier = Modifier.height(MisakaDimens.HeroCardHeight),
            imageSize = MisakaDimens.HeroImageSize
        )

        GlassCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "错题 ${wrongBook.size} 条",
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.SemiBold
                        )
                        StatusChip(scopeLabel, selected = isCurrentBankScope)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        text = "未掌握 $notMasteredCount · 已掌握 $masteredCount",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionPillButton(
                        icon = Icons.Rounded.Tune,
                        text = scopeLabel,
                        primary = scopeMode != QuizRepository.WRONG_BOOK_SCOPE_ALL_BANKS,
                        modifier = Modifier.height(42.dp),
                        onClick = { showScopePicker = true }
                    )
                    ActionPillButton(
                        icon = Icons.Rounded.DeleteOutline,
                        text = "清空",
                        primary = false,
                        modifier = Modifier.height(42.dp),
                        onClick = { showClearWrongBookConfirm = true }
                    )
                }
            }

            if (smartReviewEnabled) {
                Spacer(Modifier.height(16.dp))
                WrongBookSmartReviewSection(
                    total = smartReviewSummary.total,
                    notMastered = smartReviewSummary.notMastered,
                    masteredReview = smartReviewSummary.masteredReview,
                    onStart = {
                        if (QuizRepository.startTodayWrongBookReview()) {
                            onGoPractice()
                        }
                    }
                )
            }

            Spacer(Modifier.height(16.dp))
            Text(
                text = "掌握筛选",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                WrongBookFilter.entries.forEach { item ->
                    ActionPillButton(
                        icon = Icons.Rounded.CheckCircle,
                        text = item.label,
                        primary = filter == item,
                        modifier = Modifier
                            .weight(1f)
                            .height(44.dp),
                        fillWidthContent = true,
                        onClick = { filter = item }
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            Text(
                text = "排序",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                WrongBookSort.entries.forEach { item ->
                    ActionPillButton(
                        icon = Icons.Rounded.PlayArrow,
                        text = item.label,
                        primary = sort == item,
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 44.dp),
                        fillWidthContent = true,
                        textMaxLines = 2,
                        onClick = { sort = item }
                    )
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                ActionPillButton(
                    icon = Icons.Rounded.PlayArrow,
                    text = if (smartReviewEnabled) "刷当前筛选" else if (isCurrentBankScope) "刷当前题库" else "刷错题",
                    primary = reviewEntries.isNotEmpty(),
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp),
                    fillWidthContent = true,
                    onClick = {
                        if (reviewEntries.isNotEmpty() && QuizRepository.startWrongBookPractice(reviewEntries)) {
                            onGoPractice()
                        }
                    }
                )
                ActionPillButton(
                    icon = Icons.AutoMirrored.Rounded.Undo,
                    text = "返回",
                    primary = false,
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp),
                    fillWidthContent = true,
                    onClick = onBack
                )
            }

            if (reviewEntries.isEmpty()) {
                Spacer(Modifier.height(12.dp))
                NoticeCard(
                    text = if (filter == WrongBookFilter.MASTERED) {
                        "已掌握题不会进入刷错题。需要复习时可先标为未掌握。"
                    } else {
                        "当前筛选下没有需要复习的错题。"
                    }
                )
            }
        }

        if (filteredEntries.isEmpty()) {
            GlassCard { NoticeCard("当前筛选下没有错题。") }
        } else {
            filteredEntries.forEach { entry ->
                WrongQuestionPreview(entry)
            }
        }
    }
}


@Composable
private fun WrongBookSmartReviewSection(
    total: Int,
    notMastered: Int,
    masteredReview: Int,
    onStart: () -> Unit
) {
    Text(
        text = "今日复习",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold
    )
    Spacer(Modifier.height(8.dp))
    Text(
        text = "未掌握 $notMastered · 已掌握回顾 $masteredReview",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
    Spacer(Modifier.height(10.dp))
    ActionPillButton(
        icon = Icons.Rounded.PlayArrow,
        text = if (total > 0) "开始今日复习" else "今日暂无到期",
        primary = total > 0,
        modifier = Modifier
            .fillMaxWidth(0.58f)
            .height(44.dp),
        fillWidthContent = true,
        onClick = {
            if (total > 0) onStart()
        }
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WrongQuestionPreview(entry: WrongQuestionEntry) {
    var showRemoveConfirm by remember(entry.bankId, entry.question.id) { mutableStateOf(false) }

    if (showRemoveConfirm) {
        MisakaDangerConfirmDialog(
            title = "确认移出这道错题？",
            message = "这会从错题本中移出本题，并清除这道题当前的错题复习状态。原题库中的题目不会被删除。",
            confirmText = "确认移出",
            onDismiss = { showRemoveConfirm = false },
            onConfirm = {
                QuizRepository.removeWrongQuestion(entry)
                showRemoveConfirm = false
            }
        )
    }

    GlassCard {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusChip(displayWrongStatus(entry.status), selected = entry.status != WrongStatus.MASTERED.label)
            StatusChip(typeLabel(entry.question.type))
            StatusChip(entry.bankName)
        }
        Spacer(Modifier.height(12.dp))
        Text(
            text = "${entry.question.number}. ${entry.question.question}",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = if (MultiBlankSupport.hasStructuredAnswers(entry.question)) {
                "正确答案：\n${MultiBlankSupport.expectedAnswerText(entry.question.blankAnswers)}"
            } else {
                "正确答案：${entry.question.answer.joinToString(" / ").ifBlank { "未识别答案" }}"
            },
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "上次答案：${entry.lastAnswer.joinToString(" / ").ifBlank { "未作答" }}",
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = "错 ${entry.wrongCount} 次 · 对 ${entry.rightCount} 次 · 最近错误 ${formatTimestamp(entry.lastWrongAt)}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            ActionPillButton(
                icon = Icons.Rounded.CheckCircle,
                text = if (entry.status == WrongStatus.MASTERED.label) "重新复习" else "标记掌握",
                primary = entry.status != WrongStatus.MASTERED.label,
                modifier = Modifier
                    .weight(1f)
                    .height(46.dp),
                fillWidthContent = true,
                onClick = {
                    QuizRepository.markWrongQuestionMastered(
                        entry = entry,
                        mastered = entry.status != WrongStatus.MASTERED.label
                    )
                }
            )
            ActionPillButton(
                icon = Icons.Rounded.DeleteOutline,
                text = "移出",
                primary = false,
                modifier = Modifier
                    .weight(1f)
                    .height(46.dp),
                fillWidthContent = true,
                onClick = { showRemoveConfirm = true }
            )
        }
    }
}

private fun List<WrongQuestionEntry>.filterBy(filter: WrongBookFilter): List<WrongQuestionEntry> {
    return when (filter) {
        WrongBookFilter.NOT_MASTERED -> filter { it.status != WrongStatus.MASTERED.label }
        WrongBookFilter.MASTERED -> filter { it.status == WrongStatus.MASTERED.label }
        WrongBookFilter.ALL -> this
    }
}

private fun List<WrongQuestionEntry>.sortBy(sort: WrongBookSort): List<WrongQuestionEntry> {
    return when (sort) {
        WrongBookSort.RECENT_WRONG -> sortedByDescending { it.lastWrongAt }
        WrongBookSort.WRONG_COUNT -> sortedWith(compareByDescending<WrongQuestionEntry> { it.wrongCount }.thenByDescending { it.lastWrongAt })
        WrongBookSort.MASTERY -> sortedWith(compareBy<WrongQuestionEntry> { statusRank(it.status) }.thenByDescending { it.wrongCount })
    }
}

private fun statusRank(status: String): Int = when (status) {
    WrongStatus.MASTERED.label -> 1
    else -> 0
}

private fun displayWrongStatus(status: String): String =
    if (status == WrongStatus.MASTERED.label) "已掌握" else "未掌握"

private fun typeLabel(type: QuestionType): String = when (type) {
    QuestionType.SINGLE -> "单选题"
    QuestionType.MULTIPLE -> "多选题"
    QuestionType.JUDGE -> "判断题"
    QuestionType.BLANK -> "填空题"
    QuestionType.SHORT -> "简答题"
}

private fun formatTimestamp(timestamp: Long): String {
    return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(timestamp))
}
