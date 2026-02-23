import St from "gi://St";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

// Tonearm resting position (
export const TONEARM_PARKED_ANGLE = 25;

// Tonearm playing position
export const TONEARM_PLAYING_ANGLE = 8;

export const Tonearm = GObject.registerClass(
  class Tonearm extends St.DrawingArea {
    _init() {
      super._init({
        width: 340,
        height: 340,
        x: 0,
        y: 0,
        reactive: false,
      });

      this._isDestroyed = false;
      this._isPlaying = false;
      this._angle = TONEARM_PARKED_ANGLE;
      this._animationId = null;

      this.connectObject("repaint", (area) => this._draw(area), this);
    }

    // Animate the arm to its playing position
    moveToPlaying() {
      this._isPlaying = true;
      this._animateTo(TONEARM_PLAYING_ANGLE);
    }

    // Animate the arm back to its parked resting position
    moveToParked() {
      this._isPlaying = false;
      this._animateTo(TONEARM_PARKED_ANGLE);
    }

    // Animation

    _animateTo(targetAngle) {
      if (this._angle === targetAngle && !this._animationId) return;

      this._cancelAnimation();

      const startAngle = this._angle;
      const angleDiff = targetAngle - startAngle;

      if (Math.abs(angleDiff) < 0.1) {
        this._angle = targetAngle;
        this.queue_repaint();
        return;
      }

      const FPS = 60;
      const DURATION_MS = 600;
      const totalSteps = Math.round((DURATION_MS / 1000) * FPS);
      let step = 0;

      this._animationId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        Math.round(1000 / FPS),
        () => {
          if (this._isDestroyed) return GLib.SOURCE_REMOVE;

          step++;
          const t = step / totalSteps;
          // Ease-in-out cubic
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

          this._angle = startAngle + angleDiff * eased;
          this.queue_repaint();

          if (step >= totalSteps) {
            this._angle = targetAngle;
            this.queue_repaint();
            this._animationId = null;
            return GLib.SOURCE_REMOVE;
          }

          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _cancelAnimation() {
      if (this._animationId) {
        GLib.source_remove(this._animationId);
        this._animationId = null;
      }
    }

    // Cairo drawing

    _draw(area) {
      const cr = area.get_context();
      const [width] = area.get_surface_size();
      const centerX = width / 2;
      const centerY = width / 2;
      const radius = width / 2;

      // Pivot: upper-right quadrant
      const pivotX = centerX + radius * 0.75;
      const pivotY = centerY - radius * 0.75;

      const rad = (this._angle * Math.PI) / 180;
      const armLength = 95;

      const armEndX = pivotX - armLength * Math.cos(rad);
      const armEndY = pivotY + armLength * Math.sin(rad);

      // Pivot bearing

      // Outer shadow ring
      cr.arc(pivotX, pivotY, 11, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.2, 0.2, 0.2, 0.4);
      cr.fill();

      // Base plate
      cr.arc(pivotX, pivotY, 10, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.45, 0.45, 0.45, 0.9);
      cr.fill();

      // Inner ring
      cr.arc(pivotX, pivotY, 7.5, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.65, 0.65, 0.65, 0.95);
      cr.fill();

      // Centre screw
      cr.arc(pivotX, pivotY, 4, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.35, 0.35, 0.35, 1);
      cr.fill();

      // Screw slot
      cr.setLineWidth(1);
      cr.moveTo(pivotX - 2.5, pivotY);
      cr.lineTo(pivotX + 2.5, pivotY);
      cr.setSourceRGBA(0.1, 0.1, 0.1, 0.8);
      cr.stroke();

      //Main arm tube

      // Drop shadow
      cr.setLineWidth(5.5);
      cr.moveTo(pivotX + 1, pivotY + 1);
      cr.lineTo(armEndX + 1, armEndY + 1);
      cr.setSourceRGBA(0, 0, 0, 0.3);
      cr.stroke();

      // Tube body
      cr.setLineWidth(4.5);
      cr.moveTo(pivotX, pivotY);
      cr.lineTo(armEndX, armEndY);
      cr.setSourceRGBA(0.55, 0.55, 0.58, 0.95);
      cr.stroke();

      // Metallic highlight
      cr.setLineWidth(1.5);
      cr.moveTo(pivotX, pivotY);
      cr.lineTo(armEndX, armEndY);
      cr.setSourceRGBA(0.85, 0.85, 0.88, 0.6);
      cr.stroke();

      //Headshell

      const headshellLength = 20;
      const hsEndX = armEndX - headshellLength * Math.cos(rad);
      const hsEndY = armEndY + headshellLength * Math.sin(rad);

      // Shadow
      cr.setLineWidth(6.5);
      cr.moveTo(armEndX + 0.5, armEndY + 0.5);
      cr.lineTo(hsEndX + 0.5, hsEndY + 0.5);
      cr.setSourceRGBA(0, 0, 0, 0.3);
      cr.stroke();

      // Body
      cr.setLineWidth(5.5);
      cr.moveTo(armEndX, armEndY);
      cr.lineTo(hsEndX, hsEndY);
      cr.setSourceRGBA(0.5, 0.5, 0.52, 1);
      cr.stroke();

      // Detail highlight
      cr.setLineWidth(2);
      cr.moveTo(armEndX, armEndY);
      cr.lineTo(hsEndX, hsEndY);
      cr.setSourceRGBA(0.75, 0.75, 0.77, 0.7);
      cr.stroke();

      //Cartridge

      const cartR = 4.5;

      cr.arc(hsEndX + 0.5, hsEndY + 0.5, cartR + 1, 0, 2 * Math.PI);
      cr.setSourceRGBA(0, 0, 0, 0.3);
      cr.fill();

      cr.arc(hsEndX, hsEndY, cartR, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.3, 0.3, 0.32, 1);
      cr.fill();

      cr.arc(hsEndX - 1, hsEndY - 1, cartR * 0.6, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.5, 0.5, 0.52, 0.6);
      cr.fill();

      //stylus

      const stylusLen = 6;
      const stylusEndX = hsEndX - stylusLen * Math.cos(rad);
      const stylusEndY = hsEndY + stylusLen * Math.sin(rad);

      cr.setLineWidth(1.2);
      cr.moveTo(hsEndX, hsEndY);
      cr.lineTo(stylusEndX, stylusEndY);
      cr.setSourceRGBA(0.9, 0.9, 0.92, 1);
      cr.stroke();

      // Tip
      cr.arc(stylusEndX, stylusEndY, 1.5, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.95, 0.95, 0.95, 1);
      cr.fill();

      // Glow when stylus is on the groove and playing
      if (this._isPlaying && this._angle <= TONEARM_PLAYING_ANGLE + 2) {
        cr.arc(stylusEndX, stylusEndY, 3.5, 0, 2 * Math.PI);
        cr.setSourceRGBA(1, 1, 1, 0.25);
        cr.fill();
      }

      //Counterweight

      const cwX = pivotX + 25 * Math.cos(rad);
      const cwY = pivotY - 25 * Math.sin(rad);

      cr.arc(cwX, cwY, 6, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.4, 0.4, 0.42, 0.95);
      cr.fill();

      cr.arc(cwX, cwY, 4, 0, 2 * Math.PI);
      cr.setSourceRGBA(0.6, 0.6, 0.62, 0.8);
      cr.fill();

      cr.$dispose();
    }

    destroy() {
      this._isDestroyed = true;
      this._cancelAnimation();
      this.disconnectObject(this);
      super.destroy();
    }
  },
);
