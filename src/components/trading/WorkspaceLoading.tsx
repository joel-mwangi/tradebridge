"use client";

import styles from "./WorkspaceLoading.module.css";

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`${styles.block} ${className}`} />;
}

/**
 * Branded dashboard skeleton used before the workspace is ready.
 * It deliberately contains no sample prices, balances, or connection jargon.
 */
export default function WorkspaceLoading() {
  return (
    <main className={styles.screen} aria-busy="true" aria-label="Loading trading workspace">
      <header className={styles.header}>
        <div className={styles.brandMark} aria-hidden="true">T</div>
        <span className={styles.brandName}>Trade<span>Bridge</span></span>
      </header>

      <section className={styles.content} aria-hidden="true">
        <div className={styles.pageHeading}>
          <SkeletonBlock className={styles.headingLine} />
          <SkeletonBlock className={styles.headingMeta} />
        </div>

        <div className={styles.summaryGrid}>
          <div className={styles.panel}>
            <SkeletonBlock className={styles.labelLine} />
            <SkeletonBlock className={styles.valueLine} />
            <SkeletonBlock className={styles.shortLine} />
          </div>
          <div className={styles.panel}>
            <SkeletonBlock className={styles.labelLine} />
            <SkeletonBlock className={styles.valueLine} />
            <SkeletonBlock className={styles.shortLine} />
          </div>
          <div className={styles.panel}>
            <SkeletonBlock className={styles.labelLine} />
            <SkeletonBlock className={styles.valueLine} />
            <SkeletonBlock className={styles.shortLine} />
          </div>
        </div>

        <div className={styles.mainGrid}>
          <div className={styles.leftColumn}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <SkeletonBlock className={styles.panelTitle} />
                <SkeletonBlock className={styles.controlPill} />
              </div>
              <div className={styles.chart}>
                <div className={styles.chartLines}>
                  <SkeletonBlock className={styles.chartLine} />
                  <SkeletonBlock className={styles.chartLine} />
                  <SkeletonBlock className={styles.chartLine} />
                  <SkeletonBlock className={styles.chartLine} />
                </div>
                <SkeletonBlock className={styles.chartShape} />
              </div>
              <div className={styles.chartFooter}>
                <SkeletonBlock className={styles.shortLine} />
                <SkeletonBlock className={styles.shortLine} />
              </div>
            </section>
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <SkeletonBlock className={styles.panelTitle} />
                <SkeletonBlock className={styles.controlPill} />
              </div>
              <div className={styles.marketRows}>
                {[1, 2, 3, 4].map((item) => (
                  <div className={styles.marketRow} key={item}>
                    <SkeletonBlock className={styles.marketIcon} />
                    <SkeletonBlock className={styles.marketName} />
                    <SkeletonBlock className={styles.marketPrice} />
                    <SkeletonBlock className={styles.marketChange} />
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className={styles.panel}>
            <div className={styles.panelHeader}>
              <SkeletonBlock className={styles.panelTitle} />
              <SkeletonBlock className={styles.controlPill} />
            </div>
            <SkeletonBlock className={styles.labelLine} />
            <SkeletonBlock className={styles.inputLine} />
            <SkeletonBlock className={styles.labelLine} />
            <SkeletonBlock className={styles.inputLine} />
            <div className={styles.twoControls}>
              <SkeletonBlock className={styles.inputLine} />
              <SkeletonBlock className={styles.inputLine} />
            </div>
            <SkeletonBlock className={styles.primaryAction} />
            <SkeletonBlock className={styles.labelLine} />
            <SkeletonBlock className={styles.inputLine} />
          </aside>
        </div>
      </section>
      <span className={styles.srOnly} role="status">Preparing your trading workspace.</span>
    </main>
  );
}
