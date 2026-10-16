const { registerPopup, resolveAgree, resolveDisagree, openContract } = require('../../utils/privacy.js');

Component({
  data: {
    visible: false
  },
  lifetimes: {
    attached() {
      // 注册弹窗开关回调：微信要求授权时 -> visible=true
      registerPopup((show) => {
        this.setData({ visible: !!show });
      });
    }
  },
  methods: {
    onAgree() {
      resolveAgree();
      this.setData({ visible: false });
    },
    onDisagree() {
      resolveDisagree();
      this.setData({ visible: false });
    },
    openContract() {
      openContract();
    }
  }
});
