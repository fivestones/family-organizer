import React from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * A progress ring built from plain views, so it needs no SVG library.
 *
 * Two half-discs turn about the centre over a track-coloured disc, and an
 * inner disc in the screen's own colour hollows them into a ring. The first
 * half sweeps the right side (0–50%); the second takes over for the left.
 * `backgroundColor` must match whatever the ring sits on.
 */
export function CountdownRing({ size, thickness, progress, color, trackColor, backgroundColor, children }) {
  const radius = size / 2;
  const degrees = Math.max(0, Math.min(1, progress || 0)) * 360;
  const pastHalf = degrees > 180;

  const half = (rotation, fill) => (
    <View
      style={[
        styles.half,
        {
          width: radius,
          height: size,
          borderTopLeftRadius: radius,
          borderBottomLeftRadius: radius,
          backgroundColor: fill,
          // Turn about the disc's centre, which is this half's right edge.
          transform: [{ translateX: radius / 2 }, { rotate: `${rotation}deg` }, { translateX: -radius / 2 }],
        },
      ]}
    />
  );

  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: radius, backgroundColor: trackColor }]}>
      {half(pastHalf ? 180 : degrees, color)}
      {/* Until halfway this one hides the first half's starting position. */}
      {half(pastHalf ? degrees : 0, pastHalf ? color : trackColor)}
      <View
        style={[
          styles.hole,
          {
            width: size - thickness * 2,
            height: size - thickness * 2,
            borderRadius: radius - thickness,
            backgroundColor,
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  half: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  hole: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
