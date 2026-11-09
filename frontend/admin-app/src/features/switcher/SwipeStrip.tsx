import { useEffect, useState } from 'react';
import { Carousel } from '@mantine/carousel';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import type { EmblaCarouselType } from 'embla-carousel';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { sportProps } from '../../theme';
import { t as tx, useLocale } from '../../i18n';
import { ReviewBadge } from './OpenTabs';
import { useEntryInfo, useOrderedItems } from './entries';
import { openPath, type OpenItem } from './openItems';
import classes from './SwipeStrip.module.css';

function Slide({ item, active }: { item: OpenItem; active: boolean }) {
  const info = useEntryInfo(item);
  return (
    <Carousel.Slide>
      <Paper
        component={Link}
        to={info.path}
        className={classes.slide}
        data-active={active || undefined}
        {...sportProps(info.sport)}
        aria-label={info.name}
        aria-current={active ? 'page' : undefined}
      >
        <Group gap={8} wrap="nowrap" justify="space-between">
          <Stack gap={0} miw={0}>
            <Text className={classes.name} lineClamp={1}>
              {info.name}
            </Text>
            <Text className={classes.eyebrow} lineClamp={1}>
              {info.eyebrow}
            </Text>
          </Stack>
          <Group gap={6} wrap="nowrap">
            <ReviewBadge count={info.review} />
          </Group>
        </Group>
      </Paper>
    </Carousel.Slide>
  );
}

export const STRIP_HEIGHT = 62;

// Phone-only strip under the workspace title: one slide per open item with peeking neighbours.
// Swiping settles on a neighbour and opens it; the arrow controls are the tap alternative. It lives
// in the header only, so horizontally scrolling tables below never fight with it.
export function SwipeStrip() {
  useLocale();
  const items = useOrderedItems();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [embla, setEmbla] = useState<EmblaCarouselType | null>(null);
  const activeIndex = items.findIndex((i) => pathname === openPath(i));

  useEffect(() => {
    if (embla && activeIndex >= 0 && embla.selectedScrollSnap() !== activeIndex)
      embla.scrollTo(activeIndex);
  }, [embla, activeIndex]);

  if (items.length < 2) return null;
  return (
    <div
      className={classes.strip}
      data-testid="swipe-strip"
      aria-label={tx('Open tournaments')}
      role="group"
    >
      <Carousel
        getEmblaApi={setEmbla}
        initialSlide={Math.max(0, activeIndex)}
        slideSize="72%"
        slideGap="xs"
        emblaOptions={{ align: 'center', containScroll: false, dragFree: false }}
        withIndicators
        withKeyboardEvents={false}
        controlSize={26}
        controlsOffset={0}
        previousControlIcon={<IconChevronLeft size={16} />}
        nextControlIcon={<IconChevronRight size={16} />}
        previousControlProps={{ 'aria-label': tx('Previous tournament') }}
        nextControlProps={{ 'aria-label': tx('Next tournament') }}
        classNames={{
          root: classes.root,
          indicator: classes.indicator,
          indicators: classes.indicators,
        }}
        onSlideChange={(index) => {
          const target = items[index];
          if (target && index !== activeIndex) navigate(openPath(target));
        }}
      >
        {items.map((item, i) => (
          <Slide key={item.kind + item.id} item={item} active={i === activeIndex} />
        ))}
      </Carousel>
    </div>
  );
}
