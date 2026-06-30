package com.yiqiu.misakaquiz.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.yiqiu.misakaquiz.importer.model.QuestionType
import com.yiqiu.misakaquiz.state.FavoriteQuestionEntry
import com.yiqiu.misakaquiz.state.QuizRepository
import com.yiqiu.misakaquiz.ui.components.ActionPillButton
import com.yiqiu.misakaquiz.ui.components.GlassCard
import com.yiqiu.misakaquiz.ui.components.MisakaHeader
import com.yiqiu.misakaquiz.ui.components.NoticeCard
import com.yiqiu.misakaquiz.ui.components.StatusChip
import com.yiqiu.misakaquiz.ui.components.misakaNoRippleClickable
import com.yiqiu.misakaquiz.ui.theme.MisakaRadius
import com.yiqiu.misakaquiz.ui.theme.MisakaSpacing
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FavoriteScreen(
    onBack: () -> Unit,
    onGoPractice: () -> Unit
) {
    val context = LocalContext.current
    val favorites = QuizRepository.favoriteQuestions.toList()
    var favGroupFilter by remember { mutableStateOf<String?>(null) }
    var favBankFilter by remember { mutableStateOf<String?>(null) }
    var showFavGroupPicker by remember { mutableStateOf(false) }

    val filtered = when {
        favBankFilter != null -> favorites.filter { it.bankId == favBankFilter }
        favGroupFilter != null -> favorites.filter { entry ->
            (QuizRepository.banks.find { it.id == entry.bankId }?.groupName?.ifBlank { "未分组" }) == favGroupFilter
        }
        else -> favorites
    }

    val favGroups = favorites.mapNotNull { entry ->
        QuizRepository.banks.find { it.id == entry.bankId }?.groupName?.ifBlank { "未分组" }
    }.distinct().sortedWith(compareBy<String> { it == "未分组" }.thenBy { it })

    if (showFavGroupPicker) {
        var expandedPickerGroups by remember { mutableStateOf(setOf<String>()) }
        AlertDialog(
            onDismissRequest = { showFavGroupPicker = false },
            title = { Text("选择分组") },
            text = {
                Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                    // "全部" option
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .misakaNoRippleClickable {
                                favGroupFilter = null
                                favBankFilter = null
                                showFavGroupPicker = false
                            },
                        shape = RoundedCornerShape(12.dp),
                        color = if (favGroupFilter == null && favBankFilter == null)
                            MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                        else Color.Transparent
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "全部",
                                modifier = Modifier.weight(1f),
                                style = MaterialTheme.typography.bodyLarge,
                                fontWeight = if (favGroupFilter == null && favBankFilter == null) FontWeight.SemiBold else FontWeight.Normal
                            )
                            Text(
                                "${favorites.size}题",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                    favGroups.forEach { group ->
                        val banksInGroup = QuizRepository.banks.filter {
                            (it.groupName.ifBlank { "未分组" }) == group
                        }
                        val groupCount = favorites.count { entry ->
                            (QuizRepository.banks.find { it.id == entry.bankId }?.groupName?.ifBlank { "未分组" }) == group
                        }
                        val isGroupSelected = favGroupFilter == group && favBankFilter == null
                        val isExpanded = group in expandedPickerGroups
                        // Group header
                        Row(modifier = Modifier.fillMaxWidth().misakaNoRippleClickable {
                            expandedPickerGroups = if (isExpanded) expandedPickerGroups - group else expandedPickerGroups + group
                        }, verticalAlignment = Alignment.CenterVertically) {
                            Surface(
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(12.dp),
                                color = if (isGroupSelected && !isExpanded) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent
                            ) {
                                Row(
                                    modifier = Modifier.misakaNoRippleClickable {
                                        favGroupFilter = group
                                        favBankFilter = null
                                        showFavGroupPicker = false
                                    }.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = if (isExpanded) Icons.Rounded.ExpandMore else Icons.Rounded.ChevronRight,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(Modifier.width(6.dp))
                                    Text(group, style = MaterialTheme.typography.bodyLarge, fontWeight = if (isGroupSelected) FontWeight.SemiBold else FontWeight.Normal)
                                    Spacer(Modifier.weight(1f))
                                    Text("${groupCount}题", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        // Bank sub-rows
                        if (isExpanded) {
                            banksInGroup.sortedBy { it.name }.forEach { bank ->
                                val bankCount = favorites.count { it.bankId == bank.id }
                                val isBankSelected = favBankFilter == bank.id
                                Surface(
                                    modifier = Modifier.fillMaxWidth().padding(start = 28.dp).misakaNoRippleClickable {
                                        favGroupFilter = null
                                        favBankFilter = bank.id
                                        showFavGroupPicker = false
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
            confirmButton = {
                TextButton(onClick = { showFavGroupPicker = false }) {
                    Text("取消")
                }
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
            kicker = "Favorites",
            title = "收藏夹",
            subtitle = "集中查看和练习你主动标记的题目。"
        )

        if (favorites.isEmpty()) {
            GlassCard {
                NoticeCard("收藏夹还是空的。练习时点击题目右上角星标即可收藏。")
                Spacer(Modifier.height(12.dp))
                ActionPillButton(
                    icon = Icons.AutoMirrored.Rounded.ArrowBack,
                    text = "返回首页",
                    primary = false,
                    modifier = Modifier.height(44.dp),
                    onClick = onBack
                )
            }
            return
        }

        GlassCard {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "收藏 ${filtered.size} 题",
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Spacer(Modifier.weight(1f))
                ActionPillButton(
                    icon = Icons.Rounded.Tune,
                    text = when {
                        favBankFilter != null -> QuizRepository.banks.find { it.id == favBankFilter }?.name ?: "题库"
                        favGroupFilter != null -> favGroupFilter!!
                        else -> "按分组"
                    },
                    primary = favGroupFilter != null,
                    modifier = Modifier.height(36.dp),
                    onClick = { showFavGroupPicker = true }
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                text = "收藏夹由你手动标记，可用于集中回看和再次练习。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(14.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                ActionPillButton(
                    icon = Icons.Rounded.PlayArrow,
                    text = "练习收藏题",
                    primary = true,
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp),
                    fillWidthContent = true,
                    onClick = {
                        if (QuizRepository.startFavoritePractice(filtered)) {
                            onGoPractice()
                        }
                    }
                )
                ActionPillButton(
                    icon = Icons.AutoMirrored.Rounded.ArrowBack,
                    text = "返回",
                    primary = false,
                    modifier = Modifier
                        .weight(1f)
                        .height(50.dp),
                    fillWidthContent = true,
                    onClick = onBack
                )
            }
        }

        filtered.forEach { entry ->
            FavoriteQuestionPreview(entry)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FavoriteQuestionPreview(entry: FavoriteQuestionEntry) {
    GlassCard {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top
        ) {
            FlowRow(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                StatusChip(typeLabel(entry.question.type))
                StatusChip(entry.bankName)
                StatusChip("收藏 ${formatTimestamp(entry.favoritedAt)}")
            }
            IconButton(onClick = { QuizRepository.removeFavoriteQuestion(entry) }) {
                Icon(
                    imageVector = Icons.Rounded.Star,
                    contentDescription = "取消收藏",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
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
            text = "正确答案：${entry.question.answer.joinToString(" / ").ifBlank { "未识别答案" }}",
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        if (entry.question.analysis.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(
                text = "解析：${entry.question.analysis}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

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
