/**
 * M5 学习记录列表 — 来源徽章/正确率/耗时/得分、点击进详情、单条删除。
 * 1:1 对齐 Android RecordsScreen（含占位标题过滤 meaningfulRecordTitle）。
 */
import { router } from '@kit.ArkUI';
import { QuizRepository } from '../state/QuizRepository';
import { StudyRecord } from '../domain/Models';
import {
  MisakaColors, PillButton, StatusChip, formatShortTimestamp, formatClockSeconds, formatScoreValue
} from './common/QuizWidgets';

const TITLE_PLACEHOLDERS: string[] = ['当前题库', '原生考试', '练习记录', '考试记录', '当前练习', '当前考试'];

function meaningfulTitle(record: StudyRecord): string {
  const title = record.title.trim();
  if (title.length === 0) {
    return '';
  }
  const bankName = record.bankName.trim();
  if (TITLE_PLACEHOLDERS.includes(title)) {
    return '';
  }
  if (bankName.length > 0 && title === bankName) {
    return '';
  }
  return title;
}

@Entry
@Component
struct RecordsPage {
  private repo: QuizRepository = QuizRepository.getInstance();
  @State tick: number = 0;

  onPageShow(): void {
    this.tick += 1;
  }

  private records(): StudyRecord[] {
    return this.repo.studyRecords;
  }

  private accuracyOf(record: StudyRecord): number {
    return record.total === 0 ? 0 : Math.floor(record.correct * 100 / record.total);
  }

  private footerText(record: StudyRecord): string {
    const parts: string[] = [];
    if (record.durationSeconds !== null) {
      parts.push(`用时 ${formatClockSeconds(record.durationSeconds)}`);
    }
    parts.push(record.questionResults.length > 0 ? '点击查看详情' : '仅保留摘要');
    return parts.join(' · ');
  }

  private confirmDelete(record: StudyRecord): void {
    this.getUIContext().showAlertDialog({
      message: '删除这条学习记录？删除后无法恢复，但不会影响题库、错题本和收藏夹。',
      primaryButton: {
        value: '删除',
        action: (): void => {
          this.repo.deleteStudyRecord(record.id);
          this.tick += 1;
        }
      },
      secondaryButton: { value: '取消', action: (): void => {} }
    });
  }

  build() {
    Column() {
      Row({ space: 12 }) {
        Text('‹ 返回')
          .fontSize(16)
          .onClick((): void => {
            router.back();
          })
        Text('学习记录')
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
        Blank()
        // 引用 tick 使仓库计数变更（删除记录）时随 parity 重建一起刷新
        Text(this.tick >= 0 ? `共 ${this.repo.studyRecords.length} 条` : '')
          .fontSize(13)
          .fontColor(MisakaColors.TEXT_SUB)
      }
      .width('100%')
      .padding(16)

      Scroll() {
        Column() {
          if (this.tick % 2 === 0) {
            this.pageBody()
          } else {
            this.pageBody()
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ left: 16, right: 16, bottom: 24 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(MisakaColors.BG)
  }

  @Builder
  pageBody() {
    Column({ space: 14 }) {
      if (this.records().length === 0) {
        Column({ space: 12 }) {
          Text('这里还没有学习记录')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
          Text('完成练习或考试后，记录会自动出现在这里。')
            .fontSize(13)
            .fontColor(MisakaColors.TEXT_SUB)
          Row() {
            PillButton({ label: '返回首页', primary: false, isEnabled: true, grow: false, onTap: (): void => {
              router.back();
            } })
          }
          .width('100%')
        }
        .padding(24)
        .backgroundColor(MisakaColors.CARD)
        .borderRadius(14)
        .width('100%')
      } else {
        ForEach(this.records(), (record: StudyRecord) => {
          this.recordCard(record)
        }, (record: StudyRecord): string => record.id)
      }
    }
    .constraintSize({ maxWidth: 760 })
    .width('100%')
  }

  @Builder
  recordCard(record: StudyRecord) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Row({ space: 8 }) {
          StatusChip({ label: record.source, tone: 'primary' })
          Text(record.bankName)
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        .layoutWeight(1)
        Column({ space: 0 }) {
          Text(formatShortTimestamp(record.timestamp))
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
          Text('删除')
            .fontSize(12)
            .fontColor(MisakaColors.TEXT_SUB)
            .padding({ top: 4, bottom: 2, left: 6, right: 6 })
            .onClick((): void => {
              this.confirmDelete(record);
            })
        }
        .alignItems(HorizontalAlign.End)
      }
      .width('100%')

      if (meaningfulTitle(record).length > 0) {
        Text(meaningfulTitle(record))
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }

      Text(`${record.total} 题 · 对 ${record.correct} · 错 ${Math.max(0, record.total - record.correct)}`)
        .fontSize(13)
        .fontColor(MisakaColors.TEXT_SUB)
        .width('100%')

      Row({ space: 8 }) {
        Text(this.footerText(record))
          .fontSize(12)
          .fontColor(MisakaColors.TEXT_SUB)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        if (record.totalScore !== null && record.earnedScore !== null) {
          Text(`${formatScoreValue(record.earnedScore)} / ${formatScoreValue(record.totalScore)} 分`)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor(MisakaColors.PRIMARY)
        } else {
          Text(`正确率 ${this.accuracyOf(record)}%`)
            .fontSize(13)
            .fontWeight(FontWeight.Bold)
            .fontColor(MisakaColors.PRIMARY)
        }
      }
      .width('100%')
    }
    .padding(12)
    .backgroundColor(MisakaColors.CARD)
    .borderRadius(14)
    .width('100%')
    .onClick((): void => {
      router.pushUrl({ url: 'pages/RecordDetailPage', params: { recordId: record.id } });
    })
  }
}
