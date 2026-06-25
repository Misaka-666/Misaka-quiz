package com.yiqiu.misakaquiz.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ExitToApp
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.yiqiu.misakaquiz.R
import com.yiqiu.misakaquiz.state.QuizRepository
import com.yiqiu.misakaquiz.ui.theme.MisakaColors
import com.yiqiu.misakaquiz.ui.theme.MisakaDimens
import com.yiqiu.misakaquiz.ui.theme.MisakaMotion
import com.yiqiu.misakaquiz.ui.theme.MisakaRadius
import com.yiqiu.misakaquiz.ui.theme.MisakaSpacing
import com.yiqiu.misakaquiz.ui.text.LatexDisplayFormatter


@Composable
fun MisakaDangerConfirmDialog(
    title: String,
    message: String,
    confirmText: String = "确认",
    dismissText: String = "取消",
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmText) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(dismissText) }
        }
    )
}

@Composable
private fun Modifier.cardRiseMotion(enabled: Boolean): Modifier {
    if (!enabled) return this

    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }

    val offsetY by animateFloatAsState(
        targetValue = if (visible) 0f else 7f,
        animationSpec = tween(durationMillis = 180),
        label = "misaka_card_rise_y"
    )
    val alphaValue by animateFloatAsState(
        targetValue = if (visible) 1f else 0.92f,
        animationSpec = tween(durationMillis = 160),
        label = "misaka_card_rise_alpha"
    )

    return graphicsLayer {
        translationY = offsetY
        alpha = alphaValue
    }
}

@Composable
fun MisakaHeader(
    kicker: String,
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(MisakaSpacing.Sm)
    ) {
        if (kicker.isNotBlank()) {
            Text(
                text = kicker,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.labelLarge
            )
        }
        if (title.isNotBlank()) {
            Text(
                text = title,
                style = MaterialTheme.typography.displaySmall,
                fontWeight = FontWeight.SemiBold
            )
        }
        if (subtitle.isNotBlank()) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    animated: Boolean = true,
    contentPadding: Dp = MisakaSpacing.Xl,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .cardRiseMotion(animated),
        shape = RoundedCornerShape(MisakaRadius.Lg),
        colors = CardDefaults.cardColors(containerColor = MisakaColors.CardSoft),
        border = BorderStroke(MisakaDimens.Hairline, MisakaColors.LineSoft),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(
            modifier = Modifier.padding(contentPadding),
            content = content
        )
    }
}


@Composable
fun StatusChip(
    text: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier.defaultMinSize(minHeight = MisakaDimens.StatusChipMinHeight),
        shape = RoundedCornerShape(MisakaRadius.Pill),
        color = if (selected) MisakaColors.BrandPrimarySoft else MisakaColors.CardMuted,
        border = BorderStroke(
            MisakaDimens.Hairline,
            if (selected) MisakaColors.LineSelected else MisakaColors.LineSoft
        )
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(horizontal = MisakaDimens.StatusChipHorizontalPadding, vertical = MisakaDimens.StatusChipVerticalPadding),
            color = if (selected) MaterialTheme.colorScheme.primary else MisakaColors.TextSecondary,
            fontWeight = FontWeight.SemiBold,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}


@Composable
fun ActionPillButton(
    icon: ImageVector,
    text: String,
    primary: Boolean = true,
    modifier: Modifier = Modifier,
    fillWidthContent: Boolean = false,
    enabled: Boolean = true,
    textMaxLines: Int = 1,
    onClick: () -> Unit = {}
) {
    val shape = RoundedCornerShape(MisakaRadius.Pill)
    val interactionSource = remember { MutableInteractionSource() }

    Surface(
        modifier = modifier
            .defaultMinSize(minHeight = MisakaDimens.ActionButtonMinHeight)
            .clip(shape)
            .alpha(if (enabled) 1f else MisakaDimens.DisabledAlpha)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                enabled = enabled,
                onClick = onClick
            ),
        shape = shape,
        color = if (primary) MaterialTheme.colorScheme.primary else MisakaColors.CardWhite86,
        border = BorderStroke(
            MisakaDimens.Hairline,
            if (primary) MaterialTheme.colorScheme.primary else MisakaColors.LineStrong
        )
    ) {
        Row(
            modifier = (if (fillWidthContent) Modifier.fillMaxSize() else Modifier.defaultMinSize(minHeight = MisakaDimens.ActionButtonMinHeight))
                .padding(horizontal = if (fillWidthContent) MisakaDimens.ActionButtonEqualHorizontalPadding else MisakaDimens.ActionButtonHorizontalPadding, vertical = 0.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = if (fillWidthContent) Arrangement.Center else Arrangement.Start
        ) {
            Icon(
                imageVector = icon,
                contentDescription = text,
                modifier = Modifier.size(MisakaDimens.ActionButtonIconSize),
                tint = if (primary) MisakaColors.TextOnBrand else MaterialTheme.colorScheme.primary
            )
            Spacer(Modifier.width(if (fillWidthContent) MisakaDimens.ActionButtonEqualIconTextGap else MisakaDimens.ActionButtonIconTextGap))
            Text(
                text = text,
                color = if (primary) MisakaColors.TextOnBrand else MaterialTheme.colorScheme.onSurface,
                fontWeight = FontWeight.SemiBold,
                style = MaterialTheme.typography.labelLarge,
                maxLines = textMaxLines.coerceAtLeast(1),
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}



@Composable
fun QuizSessionExitIconButton(
    contentDescription: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val shape = CircleShape
    val interactionSource = remember { MutableInteractionSource() }

    Surface(
        modifier = modifier
            .size(46.dp)
            .clip(shape)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            ),
        shape = shape,
        color = MisakaColors.CardWhite86,
        border = BorderStroke(MisakaDimens.Hairline, MisakaColors.LineStrong)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = Icons.AutoMirrored.Rounded.ExitToApp,
                contentDescription = contentDescription,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
fun MetricGlassCard(
    label: String,
    value: String,
    desc: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    val cardModifier = if (onClick != null) modifier.misakaNoRippleClickable(onClick = onClick) else modifier
    GlassCard(modifier = cardModifier) {
        Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(MisakaSpacing.Xs))
        Text(label, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(
            text = desc,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
fun ShortcutGlassCard(
    title: String,
    icon: ImageVector,
    desc: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    val cardModifier = if (onClick != null) modifier.misakaNoRippleClickable(onClick = onClick) else modifier
    GlassCard(modifier = cardModifier) {
        Icon(icon, contentDescription = title, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(14.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(
            text = desc,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

enum class QuizOptionResultStyle {
    Neutral,
    Correct,
    Wrong
}

@Composable
fun QuizOptionCard(
    label: String,
    text: String,
    selected: Boolean,
    resultStyle: QuizOptionResultStyle = QuizOptionResultStyle.Neutral,
    compact: Boolean = QuizRepository.compactOptionsEnabled,
    onClick: () -> Unit = {}
) {
    val shape = RoundedCornerShape(MisakaRadius.Lg)
    val interactionSource = remember { MutableInteractionSource() }
    val isCorrect = resultStyle == QuizOptionResultStyle.Correct
    val isWrong = resultStyle == QuizOptionResultStyle.Wrong
    val containerColor = when (resultStyle) {
        QuizOptionResultStyle.Correct -> MisakaColors.StateSuccessSoft.copy(alpha = if (MisakaColors.isDarkMode) 0.9f else 0.72f)
        QuizOptionResultStyle.Wrong -> MisakaColors.StateDangerSoft.copy(alpha = if (MisakaColors.isDarkMode) 0.9f else 0.72f)
        QuizOptionResultStyle.Neutral -> if (selected) MisakaColors.BrandPrimarySoft else MisakaColors.CardWhite84
    }
    val borderColor = when (resultStyle) {
        QuizOptionResultStyle.Correct -> MisakaColors.StateSuccess.copy(alpha = 0.45f)
        QuizOptionResultStyle.Wrong -> MisakaColors.StateDanger.copy(alpha = 0.45f)
        QuizOptionResultStyle.Neutral -> if (selected) MisakaColors.LineSelected else MisakaColors.LineSoft
    }
    val labelColor = when (resultStyle) {
        QuizOptionResultStyle.Correct -> MisakaColors.StateSuccess
        QuizOptionResultStyle.Wrong -> MisakaColors.StateDanger
        QuizOptionResultStyle.Neutral -> if (selected) MaterialTheme.colorScheme.primary else MisakaColors.OptionLabelIdle
    }
    val labelTextColor = when {
        isCorrect || isWrong -> MisakaColors.TextOnBrand
        selected -> MisakaColors.TextOnBrand
        else -> MaterialTheme.colorScheme.onSurface
    }
    val optionFontSize = QuizRepository.optionFontSizeSp().sp
    val optionLineHeight = QuizRepository.optionLineHeightSp().sp
    val displayText = LatexDisplayFormatter.format(text)

    if (compact) {
        val compactContentColor = when {
            isCorrect -> MisakaColors.StateSuccess
            isWrong -> MisakaColors.StateDanger
            selected -> MaterialTheme.colorScheme.primary
            else -> MaterialTheme.colorScheme.onSurface
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 42.dp)
                .clip(RoundedCornerShape(10.dp))
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    onClick = onClick
                )
                .padding(horizontal = 4.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Top
        ) {
            Text(
                text = "$label.",
                color = compactContentColor,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = optionFontSize,
                    lineHeight = optionLineHeight
                )
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = displayText,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = optionFontSize,
                    lineHeight = optionLineHeight
                ),
                fontWeight = if (selected || resultStyle != QuizOptionResultStyle.Neutral) FontWeight.SemiBold else FontWeight.Normal,
                color = compactContentColor
            )
        }
        return
    }

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 64.dp)
            .clip(shape)
            .clickable(
                interactionSource = interactionSource,
                indication = null,
                onClick = onClick
            ),
        shape = shape,
        color = containerColor,
        border = BorderStroke(MisakaDimens.Hairline, borderColor)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = MisakaDimens.OptionCardHorizontalPadding, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = CircleShape,
                color = labelColor,
                modifier = Modifier.size(MisakaDimens.OptionLabelSize)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        text = label,
                        color = labelTextColor,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
            Spacer(Modifier.width(MisakaDimens.OptionLabelTextGap))
            Text(
                text = displayText,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium.copy(fontSize = optionFontSize, lineHeight = optionLineHeight),
                fontWeight = if (selected || resultStyle != QuizOptionResultStyle.Neutral) FontWeight.SemiBold else FontWeight.Normal,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (selected && resultStyle == QuizOptionResultStyle.Neutral) {
                Spacer(Modifier.width(8.dp))
                StatusChip("已选", selected = true)
            }
        }
    }
}

@Composable
fun UploadPanel(
    title: String,
    desc: String,
    icon: ImageVector
) {
    Surface(
        shape = RoundedCornerShape(MisakaRadius.Lg),
        color = MisakaColors.CardSoft,
        border = BorderStroke(MisakaDimens.Hairline, MisakaColors.LineSoft)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(MisakaSpacing.Xl),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = icon,
                contentDescription = title,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(34.dp)
            )
            Spacer(Modifier.height(12.dp))
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(6.dp))
            Text(
                text = desc,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
fun NoticeCard(
    text: String,
    warning: Boolean = true
) {
    val background = if (warning) MisakaColors.StateWarningSoft else MisakaColors.CardWhite78
    val foreground = if (warning) MisakaColors.TextWarning else MaterialTheme.colorScheme.onSurface

    Surface(
        shape = RoundedCornerShape(20.dp),
        color = background
    ) {
        Text(
            text = text,
            modifier = Modifier.padding(14.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = foreground
        )
    }
}

@Composable
fun IllustrationHeroCard(
    title: String,
    subtitle: String,
    @DrawableRes imageRes: Int,
    modifier: Modifier = Modifier,
    imageSize: Dp = MisakaDimens.HeroImageSize,
    content: @Composable ColumnScope.() -> Unit = {}
) {
    val showIllustration = QuizRepository.misakaModeEnabled

    GlassCard(modifier = modifier) {
        Row(
            modifier = if (showIllustration) {
                Modifier.fillMaxWidth()
            } else {
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
            },
            horizontalArrangement = if (showIllustration) {
                Arrangement.spacedBy(MisakaSpacing.Lg)
            } else {
                Arrangement.Center
            },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                modifier = if (showIllustration) Modifier.weight(1f) else Modifier.fillMaxWidth(),
                horizontalAlignment = if (showIllustration) Alignment.Start else Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(MisakaSpacing.Sm)
            ) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = if (showIllustration) TextAlign.Start else TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (subtitle.isNotBlank()) {
                    Text(
                        text = subtitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = if (showIllustration) TextAlign.Start else TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                content()
            }
            if (showIllustration) {
                val density = LocalDensity.current
                val floatDistancePx = with(density) { MisakaMotion.HeroFloatDistance.toPx() }
                val heroFloat = rememberInfiniteTransition(label = "hero_illustration_float")
                val imageOffsetY by heroFloat.animateFloat(
                    initialValue = -floatDistancePx,
                    targetValue = floatDistancePx,
                    animationSpec = infiniteRepeatable(
                        animation = tween(durationMillis = MisakaMotion.HeroFloatMillis),
                        repeatMode = RepeatMode.Reverse
                    ),
                    label = "hero_illustration_float_y"
                )
                Box(
                    modifier = Modifier.size(imageSize + MisakaDimens.HeroImageFrameExtra),
                    contentAlignment = Alignment.Center
                ) {
                    Image(
                        painter = painterResource(imageRes),
                        contentDescription = null,
                        modifier = Modifier
                            .size(imageSize + MisakaDimens.HeroImageFrameExtra)
                            .graphicsLayer { translationY = imageOffsetY }
                            .alpha(MisakaDimens.HeroImageAlpha),
                        contentScale = ContentScale.Fit
                    )
                }
            }
        }
    }
}

@Composable
fun EmptyStateIllustration(
    title: String,
    message: String,
    @DrawableRes imageRes: Int = R.drawable.illus_empty_state_webp,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null
) {
    GlassCard(modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(MisakaSpacing.Md)
        ) {
            if (QuizRepository.misakaModeEnabled) {
                Image(
                    painter = painterResource(imageRes),
                    contentDescription = null,
                    modifier = Modifier
                        .size(MisakaDimens.EmptyStateImageSize)
                        .alpha(0.9f),
                    contentScale = ContentScale.Fit
                )
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            action?.invoke()
        }
    }
}

@Composable
fun LoadingIllustration(
    text: String,
    @DrawableRes imageRes: Int = R.drawable.illus_loading_state_webp
) {
    val transition = rememberInfiniteTransition(label = "loading_illus")
    val scale = transition.animateFloat(
        initialValue = MisakaMotion.LoadingScaleMin,
        targetValue = MisakaMotion.LoadingScaleMax,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = MisakaMotion.LoadingScaleMillis),
            repeatMode = RepeatMode.Reverse
        ),
        label = "loading_scale"
    )

    GlassCard {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(MisakaSpacing.Md)
        ) {
            if (QuizRepository.misakaModeEnabled) {
                Image(
                    painter = painterResource(imageRes),
                    contentDescription = null,
                    modifier = Modifier
                        .size(MisakaDimens.LoadingImageSize)
                        .scale(scale.value)
                        .alpha(0.9f),
                    contentScale = ContentScale.Fit
                )
            }
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
